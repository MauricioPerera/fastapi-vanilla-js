// Property-tests congelados — contrato flat-array-coercer.
// Oráculo: importa `coerceArray` desde lib/fastapi.js y verifica su contrato.
const test = require('node:test');
const assert = require('node:assert');
const { coerceArray } = require('../../lib/fastapi');

test('array plano pasa tal cual sin itemsType', () => {
  assert.deepStrictEqual(coerceArray([1, 2, 3], 'x'), { value: [1, 2, 3] });
  assert.deepStrictEqual(coerceArray([], 'x'), { value: [] });
  assert.deepStrictEqual(coerceArray(['a', 'b'], 'x'), { value: ['a', 'b'] });
});

test('no-array devuelve { error }', () => {
  assert.ok(coerceArray('nope', 'x').error);
  assert.ok(coerceArray(42, 'x').error);
  assert.ok(coerceArray(null, 'x').error);
  assert.ok(coerceArray({ a: 1 }, 'x').error);
  assert.ok(coerceArray(undefined, 'x').error);
});

test('itemsType number coerciona strings numéricos', () => {
  assert.deepStrictEqual(coerceArray(['1', '2', '3'], 'x', { itemsType: 'number' }), { value: [1, 2, 3] });
  assert.deepStrictEqual(coerceArray(['1.5', '2'], 'x', { itemsType: 'number' }), { value: [1.5, 2] });
});

test('itemsType boolean coerciona y admite booleanos ya correctos', () => {
  assert.deepStrictEqual(coerceArray(['true', 'false'], 'x', { itemsType: 'boolean' }), { value: [true, false] });
  assert.deepStrictEqual(coerceArray([true, false, 1, 0], 'x', { itemsType: 'boolean' }), { value: [true, false, true, false] });
});

test('elemento no coercible con itemsType declarado -> { error }', () => {
  assert.ok(coerceArray([1, 'b', 3], 'x', { itemsType: 'number' }).error);
  assert.ok(coerceArray(['maybe'], 'x', { itemsType: 'boolean' }).error);
});

test('itemsType desconocido -> { value } sin coercionar (graceful)', () => {
  assert.deepStrictEqual(coerceArray([1, 2, 3], 'x', { itemsType: 'no-existe' }), { value: [1, 2, 3] });
});

test('no muta el array de entrada al coercionar elementos', () => {
  const input = ['1', '2', '3'];
  coerceArray(input, 'x', { itemsType: 'number' });
  assert.deepStrictEqual(input, ['1', '2', '3']);
});

test('rules undefined o sin itemsType es equivalente a pasar array tal cual', () => {
  assert.deepStrictEqual(coerceArray([1, 2], 'x', undefined), { value: [1, 2] });
  assert.deepStrictEqual(coerceArray([1, 2], 'x', {}), { value: [1, 2] });
});