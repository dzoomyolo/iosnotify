const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const eventsFile = path.join(dataDir, 'events.json');
const subsFile = path.join(dataDir, 'subscriptions.json');
const configFile = path.join(dataDir, 'config.json');

const MAX_EVENTS = 300;

function ensureDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function loadEvents() {
  const events = readJson(eventsFile, []);
  return Array.isArray(events) ? events : [];
}

function saveEvents(events) {
  writeJson(eventsFile, events.slice(0, MAX_EVENTS));
}

function loadSubscriptions() {
  const list = readJson(subsFile, []);
  return Array.isArray(list) ? list : [];
}

function saveSubscriptions(list) {
  writeJson(subsFile, list);
}

function loadConfig() {
  return readJson(configFile, null);
}

function saveConfig(config) {
  writeJson(configFile, config);
}

module.exports = {
  dataDir,
  loadEvents,
  saveEvents,
  loadSubscriptions,
  saveSubscriptions,
  loadConfig,
  saveConfig,
  MAX_EVENTS,
};
