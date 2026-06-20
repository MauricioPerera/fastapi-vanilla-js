// Property-tests congelados — contrato serialize-value-by-response-model.
// Verificados con el gate determinista CCDD (run_task_gate -> PASS).
const test = require('node:test');
const assert = require('node:assert');
const { serialize } = require('../../lib/validation');

test('null y undefined pasan sin proyectar', () => {
  const schema = { type: 'object', properties: { a: { type: 'number' } } };
  assert.strictEqual(serialize(null, schema), null);
  assert.strictEqual(serialize(undefined, schema), undefined);
});

test('descarta campo no declarado', () => {
  const schema = { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } };
  assert.deepStrictEqual(serialize({ a: 1, b: 2, secret: 9 }, schema), { a: 1, b: 2 });
});

test('no expone password', () => {
  const schema = { type: 'object', properties: { name: { type: 'string' } } };
  assert.deepStrictEqual(serialize({ name: 'Ana', password: 'x' }, schema), { name: 'Ana' });
});

test('filtra recursivo en objeto anidado', () => {
  const schema = {
    type: 'object',
    properties: { u: { type: 'object', properties: { name: { type: 'string' } } } }
  };
  assert.deepStrictEqual(serialize({ u: { name: 'Ana', pwd: 'x' }, extra: 1 }, schema), { u: { name: 'Ana' } });
});

test('filtra por elemento en array', () => {
  const schema = { type: 'array', items: { type: 'object', properties: { a: { type: 'number' } } } };
  assert.deepStrictEqual(serialize([{ a: 1, b: 2 }, { a: 3, c: 4 }], schema), [{ a: 1 }, { a: 3 }]);
});

test('omite campo declarado ausente', () => {
  const schema = { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } };
  assert.deepStrictEqual(serialize({ a: 1 }, schema), { a: 1 });
});

test('escalar passthrough', () => {
  assert.strictEqual(serialize(42, { type: 'number' }), 42);
  assert.strictEqual(serialize('hola', { type: 'string' }), 'hola');
});

test('no muta la entrada', () => {
  const schema = { type: 'object', properties: { a: { type: 'number' } } };
  const input = { a: 1, secret: 9 };
  serialize(input, schema);
  assert.deepStrictEqual(input, { a: 1, secret: 9 });
});
