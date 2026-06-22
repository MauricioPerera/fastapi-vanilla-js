'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { canonical } = require('../../lib/postal');

test('ordena claves lexicograficamente', () => {
  assert.strictEqual(canonical({ b: 2, a: 1 }), '{"a":1,"b":2}');
});
test('independiente del orden de insercion', () => {
  assert.strictEqual(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
});
test('arrays y objetos anidados', () => {
  assert.strictEqual(canonical([1, { b: 2, a: 1 }]), '[1,{"a":1,"b":2}]');
});
test('escalares y null', () => {
  assert.strictEqual(canonical('x'), '"x"');
  assert.strictEqual(canonical(null), 'null');
  assert.strictEqual(canonical(3), '3');
});
