// Property-tests congelados — contrato pr-parse-diff-stat.
// Oráculo independiente: solo importa parseDiffStatOutput del target.
const test = require('node:test');
const assert = require('node:assert');
const { parseDiffStatOutput } = require('../../lib/pulls');

test('vacio -> resumen cero', () => {
  const r = parseDiffStatOutput('');
  assert.deepStrictEqual(r, { files: [], totalAdditions: 0, totalDeletions: 0, filesChanged: 0 });
});

test('un archivo', () => {
  const r = parseDiffStatOutput('5\t2\tfile1.js\n');
  assert.strictEqual(r.files.length, 1);
  assert.deepStrictEqual(r.files[0], { file: 'file1.js', additions: 5, deletions: 2 });
  assert.strictEqual(r.totalAdditions, 5);
  assert.strictEqual(r.totalDeletions, 2);
  assert.strictEqual(r.filesChanged, 1);
});

test('varios archivos con totales', () => {
  const r = parseDiffStatOutput('5\t2\ta.js\n12\t0\tb.js\n');
  assert.strictEqual(r.filesChanged, 2);
  assert.strictEqual(r.totalAdditions, 17);
  assert.strictEqual(r.totalDeletions, 2);
});

test('archivo binario con guiones cuenta 0', () => {
  const r = parseDiffStatOutput('-\t-\tbinary.bin\n');
  assert.strictEqual(r.files[0].file, 'binary.bin');
  assert.strictEqual(r.files[0].additions, 0);
  assert.strictEqual(r.files[0].deletions, 0);
  assert.strictEqual(r.totalAdditions, 0);
  assert.strictEqual(r.totalDeletions, 0);
  assert.strictEqual(r.filesChanged, 1);
});

test('linea malformada se omite', () => {
  const r = parseDiffStatOutput('soloUnaCadena\n5\t2\ta.js\n');
  assert.strictEqual(r.filesChanged, 1);
  assert.strictEqual(r.files[0].file, 'a.js');
});