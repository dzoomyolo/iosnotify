const crypto = require('crypto');
const path = require('path');
const express = require('express');
const webpush = require('web-push');
const store = require('./store');
const { ensureIcons } = require('./icons');

const PORT = Number(process.env.PORT || 8787);
const publicDir = path.join(__dirname, '..', 'public');
// Apple отклоняет JWT, если subject вида mailto:...@localhost.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:iosnotify@example.com';

function readVersion() {
  const candidates = [
    path.join(__dirname, '..', '..', 'VERSION'),
    path.join(__dirname, '..', 'VERSION'),
    path.join(__dirname, '..', 'package.json'),
  ];
  for (const file of candidates) {
    try {
      const raw = require('fs').readFileSync(file, 'utf8').trim();
      if (file.endsWith('package.json')) {
        return JSON.parse(raw).version || '0.0.0';
      }
      if (raw) return raw.split(/\r?\n/)[0].trim();
    } catch {
      // пробуем следующий путь
    }
  }
  return '0.0.0';
}

const APP_VERSION = readVersion();

function randomKey() {
  return crypto.randomBytes(24).toString('base64url');
}

function loadOrCreateConfig() {
  const existing = store.loadConfig();
  const config = existing && existing.apiKey && existing.vapidPublicKey
    ? existing
    : {
        apiKey: process.env.API_KEY || randomKey(),
        vapidPublicKey: '',
        vapidPrivateKey: '',
      };

  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    const keys = webpush.generateVAPIDKeys();
    config.vapidPublicKey = keys.publicKey;
    config.vapidPrivateKey = keys.privateKey;
  }

  if (process.env.API_KEY) {
    config.apiKey = process.env.API_KEY;
  }
  if (!config.instanceId) {
    config.instanceId = crypto.randomBytes(16).toString('base64url');
  }

  store.saveConfig(config);
  return config;
}

const config = loadOrCreateConfig();
webpush.setVapidDetails(
  VAPID_SUBJECT,
  config.vapidPublicKey,
  config.vapidPrivateKey,
);

let events = store.loadEvents();
const streams = new Set();

function clip(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeEvent(body) {
  const type = ['notification', 'sms', 'call', 'test'].includes(body.type)
    ? body.type
    : 'notification';

  return {
    id: crypto.randomUUID(),
    type,
    packageName: clip(body.packageName, 120),
    appName: clip(body.appName, 80) || 'Приложение',
    title: clip(body.title, 180) || 'Без заголовка',
    body: clip(body.body, 2000),
    timestamp: Number(body.timestamp) || Date.now(),
  };
}

function apiKeyFrom(req) {
  const header = req.get('x-api-key');
  if (header) return header.trim();
  if (typeof req.query.key === 'string') return req.query.key.trim();
  return '';
}

function requireKey(req, res, next) {
  if (apiKeyFrom(req) !== config.apiKey) {
    res.status(401).json({ error: 'Неверный ключ' });
    return;
  }
  next();
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of streams) {
    res.write(payload);
  }
}

function pushCopy(event) {
  if (event.type === 'sms') {
    return { title: `SMS · ${event.title}`, body: event.body || event.title };
  }
  if (event.type === 'call') {
    return { title: `Звонок · ${event.title}`, body: event.body || 'Входящий звонок' };
  }
  const lines = [event.title, event.body].filter((line, index, all) => line && all.indexOf(line) === index);
  return { title: event.appName, body: lines.join('\n') || event.appName };
}

async function pushToDevices(event) {
  const copy = pushCopy(event);
  const payload = JSON.stringify({
    title: copy.title,
    body: copy.body,
    tag: event.id,
    timestamp: event.timestamp,
  });

  const subscriptions = store.loadSubscriptions();
  if (!subscriptions.length) {
    console.log('push skipped, no subscriptions');
    return { sent: 0, failed: 0, total: 0 };
  }

  const kept = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, payload, {
        TTL: 60 * 60,
        urgency: 'high',
      });
      kept.push(sub);
      sent += 1;
    } catch (error) {
      const status = error.statusCode;
      const body = error.body ? String(error.body).slice(0, 200) : '';
      console.error('push failed', status || error.message, body);
      if (status === 404 || status === 410) {
        failed += 1;
        return;
      }
      kept.push(sub);
      failed += 1;
    }
  }));

  if (kept.length !== subscriptions.length) {
    store.saveSubscriptions(kept);
  }
  console.log(`push sent=${sent} failed=${failed} total=${subscriptions.length}`);
  return { sent, failed, total: subscriptions.length };
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'iosnotify',
    protocol: 1,
    version: APP_VERSION,
    instanceId: config.instanceId,
  });
});

app.get('/api/session', requireKey, (_req, res) => {
  res.json({
    ok: true,
    service: 'iosnotify',
    protocol: 1,
    version: APP_VERSION,
    instanceId: config.instanceId,
  });
});

app.get('/version.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('application/javascript').send(
    `window.IOSNOTIFY_VERSION=${JSON.stringify(APP_VERSION)};\n`,
  );
});

app.get('/api/config', requireKey, (_req, res) => {
  res.json({ vapidPublicKey: config.vapidPublicKey });
});

app.get('/api/events', requireKey, (req, res) => {
  const since = Number(req.query.since) || 0;
  const list = since
    ? events.filter((item) => item.timestamp > since)
    : events;
  res.json({ events: list });
});

app.post('/api/events', requireKey, (req, res) => {
  const event = normalizeEvent(req.body || {});
  events = [event, ...events].slice(0, store.MAX_EVENTS);
  store.saveEvents(events);
  console.log(`event ${event.type} ${event.appName}`);
  broadcast(event);
  pushToDevices(event).catch((error) => {
    console.error('push batch failed', error.message);
  });
  res.status(201).json({ ok: true, id: event.id });
});

app.get('/api/stream', requireKey, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('retry: 4000\n\n');
  streams.add(res);
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(beat);
    streams.delete(res);
  });
});

app.get('/api/push/status', requireKey, (_req, res) => {
  const list = store.loadSubscriptions();
  res.json({
    count: list.length,
    endpoints: list.map((item) => {
      try {
        return new URL(item.endpoint).host;
      } catch {
        return 'unknown';
      }
    }),
  });
});

app.post('/api/push/subscribe', requireKey, (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    res.status(400).json({ error: 'Нет подписки' });
    return;
  }

  const list = store.loadSubscriptions().filter((item) => item.endpoint !== sub.endpoint);
  list.push({
    endpoint: sub.endpoint,
    expirationTime: sub.expirationTime || null,
    keys: {
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
  });
  store.saveSubscriptions(list);
  console.log(`push subscribed, total=${list.length}, host=${(() => {
    try { return new URL(sub.endpoint).host; } catch { return 'unknown'; }
  })()}`);
  res.json({ ok: true, count: list.length });
});

app.post('/api/push/test', requireKey, async (_req, res) => {
  const event = normalizeEvent({
    type: 'test',
    appName: 'IOSnotify',
    title: 'Тест пуша',
    body: 'Если это видно, Web Push доходит до iPhone',
    packageName: 'iosnotify',
    timestamp: Date.now(),
  });
  const result = await pushToDevices(event);
  res.json({ ok: true, ...result });
});

app.delete('/api/push/subscribe', requireKey, (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  const list = store.loadSubscriptions().filter((item) => item.endpoint !== endpoint);
  store.saveSubscriptions(list);
  res.json({ ok: true });
});

ensureIcons(publicDir);
app.use((req, res, next) => {
  if (
    req.path === '/sw.js'
    || req.path === '/app.js'
    || req.path === '/version.js'
    || req.path === '/manifest.json'
  ) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});
app.use(express.static(publicDir, { index: 'index.html' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`IOSnotify ${APP_VERSION} слушает http://0.0.0.0:${PORT}`);
  console.log(`Ключ доступа: ${config.apiKey}`);
  console.log(`VAPID subject: ${VAPID_SUBJECT}`);
  console.log(`Время контейнера: ${new Date().toISOString()}`);
  console.log('Его нужно вписать в Android и в сайт. Пуш на iOS работает только по HTTPS.');
});
