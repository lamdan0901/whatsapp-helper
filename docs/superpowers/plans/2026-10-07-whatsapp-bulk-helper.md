# WhatsApp Bulk Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static web page where one user manages `{{placeholder}}` message templates and sends personalized WhatsApp messages to ~10 contacts, one click per contact, via `wa.me` links.

**Architecture:** Three static files (`index.html`, `style.css`, `app.js`) with no build step and no dependencies. `app.js` is a classic script: pure functions at the top (exported through `module.exports` when Node loads it), DOM code in `initUI()` at the bottom, started only when `document` exists. `test.js` is a plain Node script that requires `app.js` and asserts on the pure functions.

**Tech Stack:** HTML, CSS, vanilla JavaScript (browser globals: `localStorage`, `crypto.randomUUID`, `Blob`, `File.text()`), Node v24 for tests only.

**Spec:** `docs/superpowers/specs/2026-10-07-whatsapp-bulk-helper-design.md`

## Global Constraints

- No dependencies, no build step, no `package.json`.
- `app.js` is a classic script (no `import`/`export` statements) so `index.html` works opened from `file://`.
- `localStorage` key is exactly `wa-helper:templates`.
- Send link is exactly `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, rendered as `<a target="_blank" rel="noopener">`.
- Placeholder syntax: regex `/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g`. `phone` is a built-in, always-required column and never appears in `fields`.
- Phone: after stripping spaces, `-`, `(`, `)`, `.`, a leading `+`, then a leading `00`, it must be 8–15 digits. Invalid-phone message is exactly `Use full international number, e.g. 85291234567`.
- New fields default to `required: true`.
- Export filename is exactly `wa-templates.json`. Import merges by `id`; imported wins.
- No "send all" button. Contact rows are never persisted.

## Review Focus

1. Copying a single cell in Excel puts `value\r\n` on the clipboard → it must land as one clean value, no extra row (Task 2 test `parseTSV single cell from Excel`; Task 6 paste handler routes any text with `\t` or `\n` through `parseTSV`).
2. A contact value that itself contains `{{other}}` → must appear literally, not be substituted again (Task 1 test `render does not re-substitute values`).
3. Messages with `&`, `?`, `#`, newlines or emoji → must arrive in WhatsApp intact (Task 1 test `waLink encodes`).
4. Corrupt or unavailable `localStorage` → page must still load, must not throw, must not wipe stored data on load (Task 3 tests `loadTemplates corrupt`, `loadTemplates no storage`, `saveTemplates throwing storage`).
5. Placeholder names that collide with JS internals (`{{constructor}}`) or are digit-only (`{{1}}`) → must behave like any other field and keep body order (Task 1 tests `render prototype-named field`, `parseFields digit names keep body order`; Task 4 test `rowErrors prototype-named field`). Columns come from `parseFields(body)`, never from `Object.keys(fields)`, because `Object.keys` moves integer-like keys first.

---

### Task 1: Message core (placeholders, render, phone, link) + test harness

**Files:**
- Create: `test.js`
- Create: `app.js`

**Interfaces:**
- Consumes: nothing.
- Produces (global functions in `app.js`, also in `module.exports`):
  - `own(obj: object|null|undefined, key: string): string` — own-property value as string, `''` if absent.
  - `parseFields(body: string): string[]` — ordered unique placeholder names, excluding `phone`.
  - `render(body: string, values: object): string` — placeholders replaced by trimmed values, `''` if missing/blank.
  - `normalizePhone(s: any): string|null` — digits or `null`.
  - `waLink(phone: string, msg: string): string`.
  - `test.js` helpers: `eq(name, actual, expected)`, `throws(name, fn)`; later tasks append sections at the end of `test.js`.

- [ ] **Step 1: Write the failing test**

Create `test.js`:

```js
// Run: node test.js
const lib = require('./app.js');

let failed = 0;
process.on('exit', (code) => {
  if (code) return; // crashed before finishing; keep Node's error exit code
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exitCode = failed ? 1 : 0;
});

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return console.log(`ok   ${name}`);
  failed++;
  console.log(`FAIL ${name}\n  got:  ${a}\n  want: ${e}`);
}

function throws(name, fn) {
  try {
    fn();
  } catch {
    return console.log(`ok   ${name}`);
  }
  failed++;
  console.log(`FAIL ${name}: did not throw`);
}

// --- message core ---
const { parseFields, render, normalizePhone, waLink } = lib;
eq('parseFields order + dedupe', parseFields('{{b}} {{a}} {{b}}'), ['b', 'a']);
eq('parseFields spaces in braces', parseFields('{{ name }} {{name}}'), ['name']);
eq('parseFields excludes phone', parseFields('{{phone}} {{x}}'), ['x']);
eq('parseFields ignores invalid names', parseFields('{{first name}} {{a-b}} {{}} {x}'), []);
eq('parseFields digit names keep body order', parseFields('{{b}}{{1}}{{a}}'), ['b', '1', 'a']);
eq('render fills values', render('Hi {{name}}!', { name: 'Ann' }), 'Hi Ann!');
eq('render missing/blank -> empty', render('[{{a}}][{{b}}]', { b: '   ' }), '[][]');
eq('render repeated placeholder', render('{{a}}-{{ a }}', { a: 'x' }), 'x-x');
eq('render phone', render('call {{phone}}', { phone: '85291234567' }), 'call 85291234567');
eq('render does not re-substitute values', render('{{a}}', { a: '{{b}}', b: 'x' }), '{{b}}');
eq('render prototype-named field', render('[{{constructor}}][{{toString}}]', {}), '[][]');
eq('normalizePhone + and separators', normalizePhone('+852 9123-4567'), '85291234567');
eq('normalizePhone 00 prefix', normalizePhone('0085291234567'), '85291234567');
eq('normalizePhone parens/dots', normalizePhone('(852) 9123.4567'), '85291234567');
eq('normalizePhone too short', normalizePhone('1234567'), null);
eq('normalizePhone too long', normalizePhone('1234567890123456'), null);
eq('normalizePhone letters', normalizePhone('85291234abc'), null);
eq('normalizePhone undefined', normalizePhone(undefined), null);
eq(
  'waLink encodes',
  waLink('85291234567', 'Hi & bye?\n#1 🎉'),
  'https://wa.me/85291234567?text=Hi%20%26%20bye%3F%0A%231%20%F0%9F%8E%89',
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test.js`
Expected: crash with `Error: Cannot find module './app.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `app.js`:

```js
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

if (typeof module !== 'undefined') {
  module.exports = { own, parseFields, render, normalizePhone, waLink };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test.js`
Expected: every line starts with `ok`, last line `all passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add app.js test.js
git commit -m "feat: add template render, phone normalize and wa.me link"
```

---

### Task 2: TSV clipboard parser

**Files:**
- Modify: `app.js` (add function before the `module.exports` block; extend exports)
- Modify: `test.js` (append section at end)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `parseTSV(text: string): string[][]` — rows of cells; handles quoted cells with tabs/newlines/`""`, `\r\n`, and drops one trailing newline.

- [ ] **Step 1: Write the failing test**

Append to `test.js`:

```js
// --- TSV paste ---
const { parseTSV } = lib;
eq('parseTSV grid', parseTSV('a\tb\nc\td'), [['a', 'b'], ['c', 'd']]);
eq('parseTSV CRLF + trailing newline', parseTSV('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']]);
eq(
  'parseTSV quoted tab/newline/escaped quote',
  parseTSV('"x\ty"\t"l1\nl2"\n"say ""hi"""\tz'),
  [['x\ty', 'l1\nl2'], ['say "hi"', 'z']],
);
eq('parseTSV single cell from Excel', parseTSV('85291234567\r\n'), [['85291234567']]);
eq('parseTSV empty cells kept', parseTSV('a\t\tc'), [['a', '', 'c']]);
eq('parseTSV quote mid-cell is literal', parseTSV('5" screen\tx'), [['5" screen', 'x']]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test.js`
Expected: crash with `TypeError: parseTSV is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `app.js`, insert above the `if (typeof module !== 'undefined')` block:

```js
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
```

Replace the exports line with:

```js
  module.exports = { own, parseFields, render, normalizePhone, waLink, parseTSV };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test.js`
Expected: all `ok`, last line `all passed`.

- [ ] **Step 5: Commit**

```bash
git add app.js test.js
git commit -m "feat: add TSV clipboard parser"
```

---

### Task 3: Template store (fields sync, import/merge, localStorage)

**Files:**
- Modify: `app.js` (add above the `module.exports` block; extend exports)
- Modify: `test.js` (append section)

**Interfaces:**
- Consumes: `parseFields(body)` from Task 1.
- Produces:
  - `STORAGE_KEY = 'wa-helper:templates'`
  - Template shape: `{ id: string, name: string, body: string, fields: { [name]: { required: boolean } } }`
  - `syncFields(body: string, oldFields?: object|null): fields` — keys in body order; keeps `required` from `oldFields`, default `true`.
  - `parseImport(text: string): Template[]` — throws `Error` on bad JSON or bad shape; rebuilds `fields` from `body`.
  - `mergeTemplates(existing: Template[], imported: Template[]): Template[]` — by `id`, imported wins, existing order kept, new ones appended.
  - `loadTemplates(storage): { templates: Template[], error: Error|null }` — never throws.
  - `saveTemplates(storage, templates): boolean` — `false` if write fails or no storage.

- [ ] **Step 1: Write the failing test**

Append to `test.js`:

```js
// --- template store ---
const { syncFields, parseImport, mergeTemplates, loadTemplates, saveTemplates, STORAGE_KEY } = lib;
eq(
  'syncFields keeps flags, new default required',
  syncFields('{{a}}{{b}}', { a: { required: false } }),
  { a: { required: false }, b: { required: true } },
);
eq('syncFields drops removed', syncFields('{{b}}', { a: { required: false }, b: { required: false } }), {
  b: { required: false },
});
eq('syncFields null old', syncFields('{{a}}', null), { a: { required: true } });
eq('parseImport ok + rebuilds fields', parseImport('[{"id":"1","name":"N","body":"{{x}}"}]'), [
  { id: '1', name: 'N', body: '{{x}}', fields: { x: { required: true } } },
]);
throws('parseImport bad json', () => parseImport('{nope'));
throws('parseImport not array', () => parseImport('{"id":"1"}'));
throws('parseImport missing body', () => parseImport('[{"id":"1","name":"N"}]'));
throws('parseImport null item', () => parseImport('[null]'));
eq(
  'mergeTemplates imported wins, order kept',
  mergeTemplates(
    [{ id: '1', name: 'old' }, { id: '2', name: 'b' }],
    [{ id: '1', name: 'new' }, { id: '3', name: 'c' }],
  ).map((t) => t.name),
  ['new', 'b', 'c'],
);
const fakeStorage = (data = {}) => ({
  data,
  getItem(k) {
    return k in this.data ? this.data[k] : null;
  },
  setItem(k, v) {
    this.data[k] = v;
  },
});
eq('loadTemplates empty', loadTemplates(fakeStorage()), { templates: [], error: null });
const roundTrip = fakeStorage();
const sample = [{ id: '1', name: 'N', body: 'hi', fields: {} }];
eq('saveTemplates ok', saveTemplates(roundTrip, sample), true);
eq('loadTemplates round trip', loadTemplates(roundTrip).templates, sample);
const corrupt = fakeStorage({ [STORAGE_KEY]: '{bad' });
eq('loadTemplates corrupt -> error, no throw', loadTemplates(corrupt).error instanceof Error, true);
eq('loadTemplates corrupt leaves data untouched', corrupt.data[STORAGE_KEY], '{bad');
eq('loadTemplates no storage -> error', loadTemplates(undefined).error instanceof Error, true);
eq('saveTemplates throwing storage -> false', saveTemplates({ setItem() { throw new Error('quota'); } }, []), false);
eq('saveTemplates no storage -> false', saveTemplates(undefined, []), false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test.js`
Expected: crash with `TypeError: syncFields is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `app.js`, insert above the `if (typeof module !== 'undefined')` block:

```js
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
```

Replace the exports line with:

```js
  module.exports = {
    own, parseFields, render, normalizePhone, waLink, parseTSV,
    STORAGE_KEY, syncFields, parseImport, mergeTemplates, loadTemplates, saveTemplates,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test.js`
Expected: all `ok`, last line `all passed`.

- [ ] **Step 5: Commit**

```bash
git add app.js test.js
git commit -m "feat: add template store with import/merge and localStorage"
```

---

### Task 4: Row logic (columns, validation, paste fill)

**Files:**
- Modify: `app.js` (add above the `module.exports` block; extend exports)
- Modify: `test.js` (append section)

**Interfaces:**
- Consumes: `parseFields`, `normalizePhone`, `own` (Task 1); Template shape (Task 3).
- Produces:
  - Row shape: `{ values: { [column]: string }, sent: boolean }`
  - `columnsFor(template): string[]` — `['phone', ...parseFields(template.body)]`.
  - `rowErrors(template, values): { [column]: string }` — empty object means row valid. Phone error text `Use full international number, e.g. 85291234567`; required error text `Required`.
  - `applyPaste(rows: Row[], rowIdx: number, colIdx: number, grid: string[][], columns: string[]): Row[]` — mutates and returns `rows`; fills right/down from `(rowIdx, colIdx)`, appends `{ values: {}, sent: false }` rows as needed, ignores cells past the last column.

- [ ] **Step 1: Write the failing test**

Append to `test.js`:

```js
// --- rows ---
const { columnsFor, rowErrors, applyPaste } = lib;
const tpl = {
  body: 'Hi {{name}}{{note}} {{phone}}',
  fields: { name: { required: true }, note: { required: false } },
};
eq('columnsFor', columnsFor(tpl), ['phone', 'name', 'note']);
eq('columnsFor phone-only template', columnsFor({ body: 'call {{phone}}', fields: {} }), ['phone']);
eq('columnsFor digit names keep body order', columnsFor({ body: '{{b}}{{1}}', fields: {} }), ['phone', 'b', '1']);
eq('rowErrors valid', rowErrors(tpl, { phone: '+852 9123 4567', name: 'Ann' }), {});
eq('rowErrors bad phone + blank required', rowErrors(tpl, { phone: '123', name: '  ' }), {
  phone: 'Use full international number, e.g. 85291234567',
  name: 'Required',
});
eq('rowErrors field absent from fields map is required', Object.keys(rowErrors({ body: '{{x}}', fields: {} }, { phone: '85291234567' })), ['x']);
eq(
  'rowErrors prototype-named field',
  Object.keys(rowErrors({ body: '{{constructor}}', fields: { constructor: { required: true } } }, { phone: '85291234567' })),
  ['constructor'],
);
const pasted = applyPaste(
  [{ values: { phone: 'keep' }, sent: true }],
  0,
  1,
  [['A', 'B', 'EXTRA'], ['C']],
  ['phone', 'name', 'note'],
);
eq('applyPaste fills right/down, adds rows, ignores extra cols', pasted.map((r) => r.values), [
  { phone: 'keep', name: 'A', note: 'B' },
  { name: 'C' },
]);
eq('applyPaste new rows unsent', pasted[1].sent, false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test.js`
Expected: crash with `TypeError: columnsFor is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `app.js`, insert above the `if (typeof module !== 'undefined')` block:

```js
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
    cells.forEach((value, j) => {
      const col = columns[colIdx + j];
      if (col) row.values[col] = value;
    });
  });
  return rows;
}
```

Replace the exports line with:

```js
  module.exports = {
    own, parseFields, render, normalizePhone, waLink, parseTSV,
    STORAGE_KEY, syncFields, parseImport, mergeTemplates, loadTemplates, saveTemplates,
    columnsFor, rowErrors, applyPaste,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test.js`
Expected: all `ok`, last line `all passed`.

- [ ] **Step 5: Commit**

```bash
git add app.js test.js
git commit -m "feat: add row columns, validation and paste fill"
```

---

### Task 5: Page shell + Templates tab

**Files:**
- Create: `index.html`
- Create: `style.css`
- Modify: `app.js` (append `initUI` and its start call at the very end of the file, after the `module.exports` block)

**Interfaces:**
- Consumes: `loadTemplates`, `saveTemplates`, `syncFields`, `parseFields`, `render`, `parseImport`, `mergeTemplates` (Tasks 1, 3).
- Produces (inside `initUI`, used by Task 6): `$(id)`, `button(text, onclick)`, `showBanner(msg)`, `let templates`, `persist()`, `showTab(name)`. Element ids used by Task 6: `send-template`, `row-add`, `row-clear`, `send-table` (has `<thead>` and `<tbody>`).

- [ ] **Step 1: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp Helper</title>
  <link rel="stylesheet" href="style.css">
  <script src="app.js" defer></script>
</head>
<body>
  <header>
    <h1>WhatsApp Helper</h1>
    <nav>
      <button type="button" class="tab" data-tab="send">Send</button>
      <button type="button" class="tab" data-tab="templates">Templates</button>
    </nav>
  </header>
  <p id="banner" hidden></p>

  <section id="tab-templates" hidden>
    <div class="toolbar">
      <button type="button" id="tpl-new">New template</button>
      <button type="button" id="tpl-export">Export JSON</button>
      <label class="button">Import JSON <input id="tpl-import" type="file" accept=".json,application/json" hidden></label>
    </div>
    <ul id="tpl-list"></ul>
    <form id="tpl-editor" hidden>
      <label>Name <input id="tpl-name"></label>
      <label>Body <textarea id="tpl-body" rows="6" placeholder="Hi {{name}}, your order {{order_id}} is ready."></textarea></label>
      <fieldset>
        <legend>Fields</legend>
        <ul id="tpl-fields"></ul>
      </fieldset>
      <p>Preview</p>
      <pre id="tpl-preview"></pre>
      <button id="tpl-save" type="submit">Save</button>
      <button id="tpl-cancel" type="button">Cancel</button>
    </form>
  </section>

  <section id="tab-send" hidden>
    <div class="toolbar">
      <label>Template <select id="send-template"></select></label>
      <button type="button" id="row-add">Add row</button>
      <button type="button" id="row-clear">Clear all</button>
    </div>
    <p class="hint">Phone must be full international number. Tip: copy cells from Excel/Sheets and paste into any cell.</p>
    <div class="table-wrap">
      <table id="send-table"><thead></thead><tbody></tbody></table>
    </div>
  </section>
</body>
</html>
```

- [ ] **Step 2: Create `style.css`**

```css
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
[hidden] { display: none !important; }
body { max-width: 1100px; margin: 0 auto; padding: 16px; }
header { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
h1 { font-size: 1.4rem; margin: 0; }
button, .button {
  font: inherit; padding: 6px 12px; cursor: pointer; display: inline-block;
  border: 1px solid #888; border-radius: 6px; background: ButtonFace; color: ButtonText; text-decoration: none;
}
button:disabled { opacity: 0.5; cursor: default; }
.tab.active { font-weight: bold; border-color: #25d366; box-shadow: inset 0 -3px 0 #25d366; }
#banner { background: #fff3cd; color: #664d03; padding: 8px 12px; border-radius: 6px; }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 16px 0; }
.hint { opacity: 0.7; font-size: 0.9rem; }
#tpl-list { padding: 0; list-style: none; }
#tpl-list li { display: flex; gap: 8px; align-items: center; margin: 4px 0; }
#tpl-list span { flex: 1; }
#tpl-editor > label { display: block; margin: 8px 0; }
#tpl-name, #tpl-body { display: block; width: 100%; box-sizing: border-box; font: inherit; }
#tpl-fields { padding: 0; list-style: none; }
pre, .preview { white-space: pre-wrap; margin: 0; font-family: inherit; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #8884; padding: 4px; text-align: left; vertical-align: top; }
td input { width: 100%; min-width: 8em; box-sizing: border-box; font: inherit; }
input.invalid { outline: 2px solid #d33; }
tr.sent { opacity: 0.6; }
a.send-link { background: #25d366; color: #fff; border-color: #1da851; white-space: nowrap; }
```

- [ ] **Step 3: Append UI code to `app.js`**

Append at the very end of `app.js` (after the `module.exports` block):

```js
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

  renderList();
  showTab(templates.length ? 'send' : 'templates');
}

if (typeof document !== 'undefined') initUI();
```

- [ ] **Step 4: Verify tests and syntax still pass**

Run: `node --check app.js && node test.js`
Expected: no syntax error output; test run ends `all passed` (Node has no `document`, so `initUI` does not run).

- [ ] **Step 5: Manual check in browser**

Open `index.html` directly from disk (double-click, or `start index.html` in PowerShell). Check:
1. No templates → Templates tab active, list says "No templates yet.", no console errors (DevTools).
2. New template → Save disabled. Type name `Order` and body `Hi {{name}}, order {{ order_id }} ready.{{note}} Call {{phone}}` → fields list shows `name`, `order_id`, `note` all checked; preview `Hi [name], order [order_id] ready.[note] Call [phone]`; Save enabled.
3. Untick `note`, Save → list shows `Order`. Reload page → still there. Edit → `note` still unticked.
4. Export JSON → downloads `wa-templates.json` with the template.
5. Delete → confirm dialog → gone. Import JSON with the exported file → back. Import a `.json` containing `{"x":1}` → alert `Import failed: Expected a JSON array of {id, name, body} templates`, list unchanged.
6. DevTools console: `localStorage.setItem('wa-helper:templates','{bad')`, reload → banner "Saved templates could not be read...", `localStorage.getItem('wa-helper:templates')` still `'{bad'`.
7. Clean up: `localStorage.removeItem('wa-helper:templates')`.

- [ ] **Step 6: Commit**

```bash
git add index.html style.css app.js
git commit -m "feat: add page shell and templates tab"
```

---

### Task 6: Send tab (table, paste, validation, send links)

**Files:**
- Modify: `app.js` (inside `initUI`: one edit in `showTab`, one new block before the final `renderList();` line)

**Interfaces:**
- Consumes: from Task 5 inside `initUI`: `$`, `button`, `templates`, `showTab`; pure functions `columnsFor`, `rowErrors`, `applyPaste`, `parseTSV`, `render`, `waLink`, `normalizePhone`, `own` (Tasks 1, 2, 4).
- Produces: nothing for later tasks.

- [ ] **Step 1: Make `showTab` refresh the Send tab**

In `app.js`, inside `showTab`, replace:

```js
    $('tab-send').hidden = name !== 'send';
  }
```

with:

```js
    $('tab-send').hidden = name !== 'send';
    if (name === 'send') refreshSendSelect();
  }
```

- [ ] **Step 2: Add the Send tab block**

In `app.js`, inside `initUI`, insert directly above the final `renderList();` line:

```js
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

```

- [ ] **Step 3: Verify tests and syntax still pass**

Run: `node --check app.js && node test.js`
Expected: no syntax error output; `all passed`.

- [ ] **Step 4: Manual check in browser**

Create template `Order` with body `Hi {{name}}, order {{order_id}} ready.{{note}}`, `note` unticked. Reload `index.html` → Send tab active. Check:
1. Table header `phone *`, `name *`, `order_id *`, `note`, `Preview`. One empty row; phone/name/order_id cells red; Send button disabled.
2. Type phone `+852 9123 4567`, name `Ann`, order_id `A1` → red outlines gone, preview `Hi Ann, order A1 ready.`, green Send link. Hover link → `https://wa.me/85291234567?text=Hi%20Ann%2C%20order%20A1%20ready.`
3. Phone `123` → phone red, hovering cell shows `Use full international number, e.g. 85291234567`, Send disabled.
4. In Excel/Sheets, copy a 3×3 block (phone, name, order_id for 3 contacts), click first phone cell, paste → 3 rows filled, valid rows get Send links.
5. Copy a single Excel cell, paste into a name cell → value only, no extra row.
6. Click Send on a valid row → new tab opens WhatsApp (web or desktop prompt) with message prefilled; row dims, link reads `Sent ✓ (resend)`.
7. ✕ deletes a row; Clear all leaves one empty row; Add row appends a row.
8. Switch to Templates, edit `Order` to add `{{extra}}`, Save, back to Send → `extra *` column appears, existing rows kept.
9. Delete all templates, go to Send → select shows `No templates yet` disabled, Add row / Clear all disabled, empty table, no console errors.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: add send tab with paste, validation and wa.me links"
```
