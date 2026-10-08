const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { columnsFor, rowErrors } = require('./app.js');

test('name is always available once, independently of template placeholders', () => {
  assert.deepEqual(columnsFor({ body: 'Hello', fields: {} }), ['phone', 'name']);
  assert.deepEqual(columnsFor({ body: '{{x}} {{name}} {{x}}', fields: {} }), ['phone', 'name', 'x']);
  assert.deepEqual(rowErrors({ body: 'Hello', fields: {} }, { phone: '85291234567' }), {});
});

function worker() {
  assert.ok(fs.existsSync('./extension/background.js'), 'contact service worker must exist');
  const data = {};
  const tabs = [];
  let listener;
  let removed;
  let now = 1000;
  const chrome = {
    runtime: {
      id: 'test', getURL: (p) => `chrome-extension://test/${p}`,
      onMessage: { addListener: (fn) => { listener = fn; } },
    },
    action: { onClicked: { addListener() {} } },
    storage: { session: {
      async set(obj) { Object.assign(data, structuredClone(obj)); },
      async get(key) { return Object.hasOwn(data, key) ? { [key]: structuredClone(data[key]) } : {}; },
      async remove(key) { delete data[key]; },
    } },
    tabs: {
      async create(options) { const tab = { id: tabs.length + 10, ...options }; tabs.push(tab); return tab; },
      async update(id, options) { Object.assign(tabs.find((t) => t.id === id), options); },
      onRemoved: { addListener(fn) { removed = fn; } },
    },
  };
  const context = vm.createContext({ chrome, URL, Date: { now: () => now }, console });
  vm.runInContext(fs.readFileSync('./extension/background.js', 'utf8'), context);
  const send = (message, sender = { id: 'test', url: chrome.runtime.getURL('index.html') }) =>
    new Promise((resolve) => {
      const handled = listener(message, sender, resolve);
      if (handled !== true) resolve(undefined);
    });
  return { send, tabs, data, removed: (id) => removed(id), advance: (ms) => { now += ms; } };
}

const contact = { type: 'prepare-contact', phone: '85291234567', name: 'Ann & 李', message: 'Hi & ?\n👋' };
const recipient = (id) => ({ id: 'test', tab: { id }, frameId: 0, url: 'https://web.whatsapp.com/send?phone=85291234567' });

test('pending contact survives worker state, is bound to one tab, and is ready before navigation', async () => {
  const w = worker();
  const result = await w.send(contact);
  assert.equal(result.ok, true);
  assert.equal(w.tabs.length, 1);
  const url = new URL(w.tabs[0].url);
  assert.equal(url.hostname, 'web.whatsapp.com');
  assert.equal(url.searchParams.get('phone'), contact.phone);
  assert.equal(url.searchParams.get('text'), contact.message);
  assert.equal((await w.send({ type: 'get-contact' }, recipient(10))).contact.name, contact.name);
  assert.equal((await w.send({ type: 'get-contact' }, recipient(11))).contact, null);
  assert.equal((await w.send({ type: 'complete-contact' }, recipient(10))).ok, true);
  assert.equal((await w.send({ type: 'get-contact' }, recipient(10))).contact, null);
});

test('bad payloads and untrusted senders cannot open tabs or read pending contacts', async () => {
  const w = worker();
  for (const bad of [{ ...contact, name: ' ' }, { ...contact, phone: '+85291234567' }, { ...contact, message: null }]) {
    assert.equal((await w.send(bad)).ok, false);
  }
  assert.equal(w.tabs.length, 0);
  assert.equal(await w.send(contact, { id: 'evil', url: 'https://example.com' }), undefined);
  assert.equal(await w.send(contact, recipient(10)), undefined);
  await w.send(contact);
  assert.equal(await w.send({ type: 'get-contact' }, { ...recipient(10), url: 'https://example.com' }), undefined);
  assert.equal(await w.send({ type: 'get-contact' }, { ...recipient(10), frameId: 1 }), undefined);
});

test('pending contact expires and closing its tab clears it', async () => {
  const w = worker();
  await w.send(contact);
  w.advance(15 * 60 * 1000 + 1);
  assert.equal((await w.send({ type: 'get-contact' }, recipient(10))).contact, null);
  await w.send(contact);
  await w.removed(11);
  assert.equal((await w.send({ type: 'get-contact' }, recipient(11))).contact, null);
});
