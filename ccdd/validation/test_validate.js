// Property-tests congelados — contrato validate-value-against-schema.
// Verificados con el gate determinista CCDD (run_task_gate -> PASS).
const test = require('node:test');
const assert = require('node:assert');
const { validate } = require('../../lib/validation');

test('escalar string correcto', () => {
  const r = validate('hola', { type: 'string' });
  assert.strictEqual(r.valid, true);
  assert.deepStrictEqual(r.errors, []);
});

test('tipo incorrecto', () => {
  const r = validate(42, { type: 'string' });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].path, '');
});

test('required ausente', () => {
  const r = validate(undefined, { type: 'string', required: true });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.errors.length, 1);
});

test('opcional ausente es valido', () => {
  const r = validate(undefined, { type: 'string' });
  assert.strictEqual(r.valid, true);
});

test('constraint minimum/maximum', () => {
  assert.strictEqual(validate(5, { type: 'number', minimum: 10 }).valid, false);
  assert.strictEqual(validate(15, { type: 'number', maximum: 10 }).valid, false);
  assert.strictEqual(validate(7, { type: 'number', minimum: 1, maximum: 10 }).valid, true);
});

test('constraint minLength/maxLength', () => {
  assert.strictEqual(validate('a', { type: 'string', minLength: 2 }).valid, false);
  assert.strictEqual(validate('abcd', { type: 'string', maxLength: 3 }).valid, false);
});

test('enum', () => {
  assert.strictEqual(validate('x', { type: 'string', enum: ['a', 'b'] }).valid, false);
  assert.strictEqual(validate('a', { type: 'string', enum: ['a', 'b'] }).valid, true);
});

test('objeto anidado con hijo invalido reporta path padre.hijo', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      address: { type: 'object', properties: { city: { type: 'string', required: true } } }
    }
  };
  const r = validate({ name: 'Ana', address: {} }, schema);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.path === 'address.city'));
});

test('array con elemento invalido reporta path con indice', () => {
  const schema = { type: 'array', items: { type: 'number' } };
  const r = validate([1, 'x', 3], schema);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.path === '[1]'));
});

test('objeto valido completo', () => {
  const schema = {
    type: 'object',
    properties: {
      email: { type: 'string', required: true, minLength: 3 },
      age: { type: 'integer', minimum: 0 },
      tags: { type: 'array', items: { type: 'string' } }
    }
  };
  const r = validate({ email: 'a@b.c', age: 30, tags: ['x', 'y'] }, schema);
  assert.strictEqual(r.valid, true);
  assert.deepStrictEqual(r.errors, []);
});
