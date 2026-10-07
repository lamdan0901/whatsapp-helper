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
eq('applyPaste overwritten row unsent', pasted[0].sent, false);
