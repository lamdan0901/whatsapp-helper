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

if (typeof module !== 'undefined') {
  module.exports = { own, parseFields, render, normalizePhone, waLink, parseTSV };
}
