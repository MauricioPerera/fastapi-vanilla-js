// Property-tests congelados — contrato pr-parse-commits.
// Oráculo independiente: solo importa parseCommitsOutput del target.
const test = require('node:test');
const assert = require('node:assert');
const { parseCommitsOutput } = require('../../lib/pulls');

test('vacio -> []', () => {
  assert.deepStrictEqual(parseCommitsOutput(''), []);
  assert.deepStrictEqual(parseCommitsOutput('\n\n'), []);
});

test('un commit', () => {
  const out = parseCommitsOutput('abc|Ana|2024-01-01T00:00:00Z|fix\n');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].hash, 'abc');
  assert.strictEqual(out[0].author, 'Ana');
  assert.strictEqual(out[0].date, '2024-01-01T00:00:00Z');
  assert.strictEqual(out[0].message, 'fix');
});

test('varios commits en orden', () => {
  const out = parseCommitsOutput('a|A|d1|m1\nb|B|d2|m2\n');
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].hash, 'a');
  assert.strictEqual(out[1].hash, 'b');
});

test('message con pipe se preserva', () => {
  const out = parseCommitsOutput('a|A|d|msg con | pipe\n');
  assert.strictEqual(out[0].message, 'msg con | pipe');
});

test('linea con menos de 4 campos se omite', () => {
  const out = parseCommitsOutput('a|A|d\nb|B|d2|m2\n');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].hash, 'b');
});