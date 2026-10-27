const KEY_STORAGE = 'iosnotify-api-key';

const statusEl = document.querySelector('#status');
const feedEl = document.querySelector('#feed');
const hintEl = document.querySelector('#ios-hint');
const dialogEl = document.querySelector('#settings');
const keyInput = document.querySelector('#api-key');
const pushStateEl = document.querySelector('#push-state');

let filter = 'all';
let events = [];
let stream;

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.navigator.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches;

if (!window.isSecureContext) {
  hintEl.textContent = 'Лента уже работает. Пуш на iPhone включается только по HTTPS и только у иконки с домашнего экрана.';
  hintEl.classList.remove('hidden');
} else if (isIos && !standalone) {
  hintEl.textContent = 'Откройте сайт с иконки на домашнем экране. Пуш из обычной вкладки Safari на iPhone не работает. Внутри иконки снова сохраните ключ и нажмите «Включить пуш».';
  hintEl.classList.remove('hidden');
}

function key() {
  return localStorage.getItem(KEY_STORAGE) || '';
}

function setStatus(text) {
  statusEl.textContent = text;
}

async function api(path, options = {}) {
  const headers = { 'X-Api-Key': key(), ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Ошибка ${response.status}`);
  }
  if (response.status === 204) return null;
  const type = response.headers.get('content-type') || '';
  return type.includes('json') ? response.json() : null;
}

function formatTime(ts) {
  const date = new Date(ts);
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function badge(type) {
  if (type === 'sms') return '<span class="badge sms">sms</span>';
  if (type === 'call') return '<span class="badge call">звонок</span>';
  if (type === 'test') return '<span class="badge">тест</span>';
  return '<span class="badge">приложение</span>';
}

function render() {
  const list = events.filter((item) => filter === 'all' || item.type === filter);
  if (!list.length) {
    feedEl.innerHTML = '<p class="empty">Пока пусто. События с Android появятся здесь.</p>';
    return;
  }

  feedEl.innerHTML = list.map((item) => `
    <article class="card">
      <div class="card-head">
        <div class="app-name">${badge(item.type)}${escapeHtml(item.appName)}</div>
        <time class="time">${formatTime(item.timestamp)}</time>
      </div>
      <p class="title">${escapeHtml(item.title)}</p>
      ${item.body ? `<p class="body">${escapeHtml(item.body)}</p>` : ''}
    </article>
  `).join('');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function byTime(list) {
  return [...list].sort((a, b) => b.timestamp - a.timestamp).slice(0, 300);
}

function replace(list) {
  events = byTime(list);
  render();
}

function merge(list) {
  const map = new Map(events.map((item) => [item.id, item]));
  for (const item of list) map.set(item.id, item);
  events = byTime(map.values());
  render();
}

function upsert(event) {
  merge([event]);
}

function connectStream() {
  if (stream) stream.close();
  if (!key()) return;
  stream = new EventSource(`/api/stream?key=${encodeURIComponent(key())}`);
  stream.onmessage = (message) => {
    try {
      upsert(JSON.parse(message.data));
    } catch {
      // битый кадр просто пропускаем, следующий придёт отдельно
    }
  };
  stream.onerror = () => setStatus('Связь прервана, переподключаюсь');
  stream.onopen = () => {
    api('/api/events').then((data) => merge(data.events || [])).catch(() => {});
    setStatus(pushReady() ? 'На связи, пуш включён' : 'На связи');
  };
}

function canNotify() {
  return typeof Notification !== 'undefined';
}

function pushReady() {
  return canNotify()
    && Notification.permission === 'granted'
    && !!localStorage.getItem('iosnotify-push');
}

function sameKey(left, right) {
  if (!left || !right) return false;
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function refreshPushState() {
  const mode = standalone ? 'иконка' : 'Safari';
  if (!window.isSecureContext) {
    pushStateEl.textContent = `${mode}: нужен HTTPS`;
    return;
  }
  if (!canNotify() || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    pushStateEl.textContent = standalone
      ? `${mode}: этот браузер не даёт Web Push`
      : `${mode}: откройте с домашнего экрана`;
    return;
  }

  const permission = Notification.permission;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  localStorage.setItem('iosnotify-push', sub ? '1' : '');

  let serverCount = null;
  if (key()) {
    try {
      const status = await api('/api/push/status');
      serverCount = status.count;
    } catch {
      serverCount = null;
    }
  }

  if (sub && serverCount === 0) {
    pushStateEl.textContent = `${mode}: подписка есть на телефоне, но сервер её не видит. Нажмите «Включить пуш» ещё раз.`;
    return;
  }
  if (sub) {
    const host = (() => {
      try { return new URL(sub.endpoint).host; } catch { return 'push'; }
    })();
    pushStateEl.textContent = `${mode}: пуш включён (${host}), на сервере ${serverCount ?? '?'} подписок, permission=${permission}`;
    return;
  }
  pushStateEl.textContent = `${mode}: пуш ещё не включён, permission=${permission}, на сервере ${serverCount ?? '?'} подписок`;
}

async function loadEvents() {
  if (!key()) {
    if (stream) stream.close();
    setStatus('Введите ключ в настройках');
    events = [];
    render();
    return;
  }
  const data = await api('/api/events');
  replace(data.events || []);
  connectStream();
  await refreshPushState();
  if (!pushReady()) setStatus('На связи');
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function enablePush() {
  if (!key()) throw new Error('Сначала сохраните ключ');
  if (!window.isSecureContext) {
    throw new Error('Пуш на iPhone работает только по HTTPS');
  }
  if (isIos && !standalone) {
    throw new Error('Откройте IOSnotify с иконки на домашнем экране и включите пуш там');
  }
  if (!canNotify()) throw new Error('Браузер не умеет уведомления');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Разрешение на уведомления не выдано');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('В Safari пуш включается только с иконки на домашнем экране');
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { vapidPublicKey } = await api('/api/config');
  const appKey = urlBase64ToUint8Array(vapidPublicKey);

  let subscription = await reg.pushManager.getSubscription();
  const currentKey = subscription
    ? subscription.options && subscription.options.applicationServerKey
    : null;
  if (subscription && !sameKey(currentKey, appKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appKey,
    });
  }

  const payload = subscription.toJSON ? subscription.toJSON() : subscription;
  const result = await api('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: payload }),
  });
  localStorage.setItem('iosnotify-push', '1');
  await refreshPushState();
  setStatus(`На связи, пуш включён, подписок ${result.count}`);
}

async function testPush() {
  if (!key()) throw new Error('Сначала сохраните ключ');
  const result = await api('/api/push/test', { method: 'POST' });
  if (!result.total) throw new Error('На сервере нет подписок. С иконки нажмите «Включить пуш»');
  if (!result.sent) throw new Error(`Пуш не ушёл, failed=${result.failed}. Смотрите docker logs iosnotify`);
  pushStateEl.textContent = `Тест отправлен: sent=${result.sent}, failed=${result.failed}`;
}

document.querySelector('#settings-btn').addEventListener('click', async () => {
  keyInput.value = key();
  await refreshPushState();
  dialogEl.showModal();
});

document.querySelector('#save-key').addEventListener('click', async () => {
  localStorage.setItem(KEY_STORAGE, keyInput.value.trim());
  try {
    await loadEvents();
    dialogEl.close();
  } catch (error) {
    setStatus(error.message);
    pushStateEl.textContent = error.message;
  }
});

document.querySelector('#enable-push').addEventListener('click', async () => {
  try {
    await enablePush();
  } catch (error) {
    pushStateEl.textContent = error.message;
  }
});

document.querySelector('#test-push').addEventListener('click', async () => {
  try {
    await testPush();
  } catch (error) {
    pushStateEl.textContent = error.message;
  }
});

document.querySelectorAll('.chip').forEach((button) => {
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('.chip').forEach((chip) => {
      chip.classList.toggle('active', chip === button);
    });
    render();
  });
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

loadEvents().catch((error) => setStatus(error.message));
