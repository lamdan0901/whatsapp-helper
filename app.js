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

// Columns come from the body, not Object.keys(fields): Object.keys puts integer-like names first.
function columnsFor(template) {
  return ['phone', ...parseFields(template.body)];
}

function rowErrors(template, values) {
  const errors = {};
  if (!normalizePhone(own(values, 'phone'))) errors.phone = 'Use full international number, e.g. 85291234567';
  for (const name of parseFields(template.body)) {
    const required = !Object.hasOwn(template.fields, name) || template.fields[name].required !== false;
    if (required && !own(values, name).trim()) errors[name] = 'Required';
  }
  return errors;
}

function applyPaste(rows, rowIdx, colIdx, grid, columns) {
  grid.forEach((cells, i) => {
    const row = (rows[rowIdx + i] ??= { values: {}, sent: false });
    row.sent = false; // new contact data: the old "sent" mark no longer applies
    cells.forEach((value, j) => {
      const col = columns[colIdx + j];
      if (col) row.values[col] = value;
    });
  });
  return rows;
}

if (typeof module !== 'undefined') {
  module.exports = {
    own, parseFields, render, normalizePhone, waLink, parseTSV,
    STORAGE_KEY, syncFields, parseImport, mergeTemplates, loadTemplates, saveTemplates,
    columnsFor, rowErrors, applyPaste,
  };
}

// ---------------- UI (browser only) ----------------

function initUI() {
  const $ = (id) => document.getElementById(id);
  const button = (text, onclick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.onclick = onclick;
    return b;
  };
  const showBanner = (msg) => {
    $('banner').textContent = msg;
    $('banner').hidden = false;
  };
  const CANT_SAVE = "Templates can't be saved in this browser. Use Export JSON to keep them.";

  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    // blocked by browser privacy settings; handled below
  }
  const loaded = loadTemplates(storage);
  let templates = loaded.templates;
  if (!storage) showBanner(CANT_SAVE);
  else if (loaded.error) showBanner('Saved templates could not be read. They stay untouched until you save a template.');

  function persist() {
    if (!saveTemplates(storage, templates)) showBanner(CANT_SAVE);
  }

  // --- tabs ---
  function showTab(name) {
    for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === name);
    $('tab-templates').hidden = name !== 'templates';
    $('tab-send').hidden = name !== 'send';
    if (name === 'send') refreshSendSelect();
  }
  for (const b of document.querySelectorAll('.tab')) b.onclick = () => showTab(b.dataset.tab);

  // --- templates tab ---
  let editing = null; // draft copy of the template being edited

  function renderList() {
    const items = templates.map((t) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = t.name;
      li.append(
        name,
        button('Edit', () => openEditor(t)),
        button('Delete', () => {
          if (!confirm(`Delete template "${t.name}"?`)) return;
          templates = templates.filter((x) => x.id !== t.id);
          persist();
          renderList();
          if (editing?.id === t.id) closeEditor();
        }),
      );
      return li;
    });
    if (!items.length) {
      const li = document.createElement('li');
      li.textContent = 'No templates yet.';
      items.push(li);
    }
    $('tpl-list').replaceChildren(...items);
  }

  function openEditor(t) {
    editing = structuredClone(t ?? { id: crypto.randomUUID(), name: '', body: '', fields: {} });
    $('tpl-name').value = editing.name;
    $('tpl-body').value = editing.body;
    $('tpl-editor').hidden = false;
    updateEditor();
    $('tpl-name').focus();
  }

  function closeEditor() {
    editing = null;
    $('tpl-editor').hidden = true;
  }

  function updateEditor() {
    editing.name = $('tpl-name').value;
    editing.body = $('tpl-body').value;
    editing.fields = syncFields(editing.body, editing.fields);
    const names = parseFields(editing.body);
    const items = names.map((n) => {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = editing.fields[n].required;
      cb.onchange = () => {
        editing.fields[n].required = cb.checked;
      };
      label.append(cb, ` ${n} required`);
      li.append(label);
      return li;
    });
    if (!items.length) {
      const li = document.createElement('li');
      li.textContent = 'Add {{field}} placeholders to the body. {{phone}} is always available.';
      items.push(li);
    }
    $('tpl-fields').replaceChildren(...items);
    const samples = Object.fromEntries([...names, 'phone'].map((n) => [n, `[${n}]`]));
    $('tpl-preview').textContent = render(editing.body, samples);
    $('tpl-save').disabled = !editing.name.trim() || !editing.body.trim();
  }

  $('tpl-name').oninput = updateEditor;
  $('tpl-body').oninput = updateEditor;
  $('tpl-new').onclick = () => openEditor();
  $('tpl-cancel').onclick = closeEditor;
  $('tpl-editor').onsubmit = (e) => {
    e.preventDefault();
    if ($('tpl-save').disabled) return;
    const t = { ...editing, name: editing.name.trim() };
    const i = templates.findIndex((x) => x.id === t.id);
    if (i >= 0) templates[i] = t;
    else templates.push(t);
    persist();
    renderList();
    closeEditor();
  };

  $('tpl-export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(templates, null, 2)], { type: 'application/json' }));
    a.download = 'wa-templates.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href));
  };

  $('tpl-import').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    try {
      templates = mergeTemplates(templates, parseImport(await file.text()));
    } catch (err) {
      alert(`Import failed: ${err.message}`);
      return;
    }
    persist();
    renderList();
  };

  // --- send tab ---
  const newRow = () => ({ values: {}, sent: false });
  let sendTpl = null;
  let rows = [newRow()];

  function selectTemplate(t) {
    sendTpl = t;
    rows = [newRow()];
  }

  function refreshSendSelect() {
    const sel = $('send-template');
    sel.replaceChildren(...templates.map((t) => new Option(t.name, t.id)));
    sel.disabled = !templates.length;
    if (!templates.length) sel.append(new Option('No templates yet', ''));
    const current = sendTpl && templates.find((t) => t.id === sendTpl.id);
    if (current) {
      sendTpl = current; // pick up template edits, keep the rows
      sel.value = current.id;
    } else {
      selectTemplate(templates[0] ?? null);
    }
    renderTable();
  }

  $('send-template').onchange = (e) => {
    selectTemplate(templates.find((t) => t.id === e.target.value) ?? null);
    renderTable();
  };
  $('row-add').onclick = () => {
    rows.push(newRow());
    renderTable();
  };
  $('row-clear').onclick = () => {
    rows = [newRow()];
    renderTable();
  };

  function renderTable() {
    const table = $('send-table');
    $('row-add').disabled = $('row-clear').disabled = !sendTpl;
    if (!sendTpl) {
      table.tHead.replaceChildren();
      table.tBodies[0].replaceChildren();
      return;
    }
    const cols = columnsFor(sendTpl);
    const head = document.createElement('tr');
    const isRequired = (c) => c === 'phone' || !Object.hasOwn(sendTpl.fields, c) || sendTpl.fields[c].required !== false;
    for (const label of [...cols.map((c) => (isRequired(c) ? `${c} *` : c)), 'Preview', '', '']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.append(th);
    }
    table.tHead.replaceChildren(head);
    table.tBodies[0].replaceChildren(
      ...rows.map((row, r) => {
        const tr = document.createElement('tr');
        cols.forEach((col, c) => {
          const input = document.createElement('input');
          input.value = own(row.values, col);
          input.dataset.col = col;
          input.oninput = () => {
            row.values[col] = input.value;
            row.sent = false;
            updateRow(tr, row);
          };
          input.onpaste = (e) => {
            const text = e.clipboardData.getData('text/plain');
            if (!/[\t\n]/.test(text)) return; // single plain value: let the browser paste it
            e.preventDefault();
            applyPaste(rows, r, c, parseTSV(text), cols);
            renderTable();
          };
          tr.insertCell().append(input);
        });
        tr.insertCell().className = 'preview';
        tr.insertCell().className = 'send';
        tr.insertCell().append(
          button('✕', () => {
            rows.splice(r, 1);
            if (!rows.length) rows.push(newRow());
            renderTable();
          }),
        );
        updateRow(tr, row);
        return tr;
      }),
    );
  }

  function updateRow(tr, row) {
    const errors = rowErrors(sendTpl, row.values);
    for (const input of tr.querySelectorAll('input')) {
      const err = Object.hasOwn(errors, input.dataset.col) ? errors[input.dataset.col] : '';
      input.classList.toggle('invalid', !!err);
      input.title = err;
    }
    const msg = render(sendTpl.body, row.values);
    tr.querySelector('.preview').textContent = msg;
    tr.classList.toggle('sent', row.sent);
    const cell = tr.querySelector('.send');
    if (Object.keys(errors).length) {
      const b = button('Send', null);
      b.disabled = true;
      cell.replaceChildren(b);
      return;
    }
    const a = document.createElement('a');
    a.className = 'button send-link';
    a.href = waLink(normalizePhone(own(row.values, 'phone')), msg);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = row.sent ? 'Sent ✓ (resend)' : 'Send';
    // Defer the DOM update so replacing the link doesn't interrupt its own navigation.
    a.onclick = () =>
      setTimeout(() => {
        row.sent = true;
        updateRow(tr, row);
      });
    cell.replaceChildren(a);
  }

  renderList();
  showTab(templates.length ? 'send' : 'templates');
}

if (typeof document !== 'undefined') initUI();
