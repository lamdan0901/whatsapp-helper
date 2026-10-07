// WhatsApp Helper. Classic script (ES modules are blocked on file:// in Chrome).
// Pure logic first; Node loads this file for tests (test.js). UI starts only in a browser.

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

// Own-property lookup so names like {{constructor}} don't hit Object.prototype.
function own(obj, key) {
  return obj != null && Object.hasOwn(obj, key) ? String(obj[key] ?? '') : '';
}

function parseFields(body) {
  const names = [];
  for (const [, name] of body.matchAll(PLACEHOLDER)) {
    if (name !== 'phone' && !names.includes(name)) names.push(name);
  }
  return names;
}

function render(body, values) {
  return body.replace(PLACEHOLDER, (_, name) => own(values, name).trim());
}

function normalizePhone(s) {
  const digits = String(s ?? '')
    .replace(/[\s\-().]/g, '')
    .replace(/^\+/, '')
    .replace(/^00/, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

function waLink(phone, msg) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

// Excel/Sheets clipboard: tab-separated, cells with tab/newline/quote are wrapped in "..." with "" escapes.
function parseTSV(text) {
  text = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

const STORAGE_KEY = 'wa-helper:templates';

function syncFields(body, oldFields) {
  return Object.fromEntries(
    parseFields(body).map((n) => [n, { required: oldFields?.[n]?.required !== false }]),
  );
}

function parseImport(text) {
  const data = JSON.parse(text);
  const ok =
    Array.isArray(data) &&
    data.every((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.body === 'string');
  if (!ok) throw new Error('Expected a JSON array of {id, name, body} templates');
  return data.map((t) => ({ id: t.id, name: t.name, body: t.body, fields: syncFields(t.body, t.fields) }));
}

function mergeTemplates(existing, imported) {
  const byId = new Map(existing.map((t) => [t.id, t]));
  for (const t of imported) byId.set(t.id, t);
  return [...byId.values()];
}

function loadTemplates(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return { templates: raw == null ? [] : parseImport(raw), error: null };
  } catch (error) {
    return { templates: [], error };
  }
}

function saveTemplates(storage, templates) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(templates));
    return true;
  } catch {
    return false;
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    own, parseFields, render, normalizePhone, waLink, parseTSV,
    STORAGE_KEY, syncFields, parseImport, mergeTemplates, loadTemplates, saveTemplates,
  };
}
