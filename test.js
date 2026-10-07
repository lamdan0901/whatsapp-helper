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
