// Property-tests congelados — contrato coerce-value-to-schema-types.
// Verificados con el gate determinista CCDD (run_task_gate -> PASS).
const test = require('node:test');
const assert = require('node:assert');
const { coerce } = require('../../lib/validation');

test('number desde string', () => {
  assert.strictEqual(coerce('30', { type: 'number' }), 30);
  assert.strictEqual(coerce('3.5', { type: 'number' }), 3.5);
  assert.strictEqual(coerce('abc', { type: 'number' }), 'abc');
});

test('integer', () => {
  assert.strictEqual(coerce('5', { type: 'integer' }), 5);
  assert.strictEqual(coerce('5.5', { type: 'integer' }), '5.5');
});

test('boolean', () => {
  assert.strictEqual(coerce('true', { type: 'boolean' }), true);
  assert.strictEqual(coerce('false', { type: 'boolean' }), false);
  assert.strictEqual(coerce('1', { type: 'boolean' }), true);
  assert.strictEqual(coerce('0', { type: 'boolean' }), false);
  assert.strictEqual(coerce('x', { type: 'boolean' }), 'x');
});

test('string desde number/boolean', () => {
  assert.strictEqual(coerce(42, { type: 'string' }), '42');
  assert.strictEqual(coerce(true, { type: 'string' }), 'true');
});

test('objeto coerciona declarados y conserva extras', () => {
  const schema = { type: 'object', properties: { age: { type: 'integer' } } };
  assert.deepStrictEqual(coerce({ age: '30', x: 1 }, schema), { age: 30, x: 1 });
});

test('array coerciona items', () => {
  const schema = { type: 'array', items: { type: 'integer' } };
  assert.deepStrictEqual(coerce(['1', '2'], schema), [1, 2]);
});

test('nullish passthrough', () => {
  assert.strictEqual(coerce(null, { type: 'number' }), null);
  assert.strictEqual(coerce(undefined, { type: 'number' }), undefined);
});

test('no muta la entrada', () => {
  const schema = { type: 'object', properties: { age: { type: 'integer' } } };
  const input = { age: '30' };
  coerce(input, schema);
  assert.strictEqual(input.age, '30');
});
