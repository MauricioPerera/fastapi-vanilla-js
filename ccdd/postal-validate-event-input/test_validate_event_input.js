'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateEventInput, PostalError } = require('../../lib/postal');

test('input valido devuelve misma ref', () => {
  const i = { kind: 'x', agentId: 'a' };
  assert.strictEqual(validateEventInput(i), i);
});
test('kind vacio lanza', () => {
  assert.throws(() => validateEventInput({ kind: '', agentId: 'a' }), (e) => e instanceof PostalError && e.code === 'invalid_input');
});
test('agentId vacio lanza', () => {
  assert.throws(() => validateEventInput({ kind: 'x', agentId: '' }), (e) => e instanceof PostalError && e.code === 'invalid_input');
});
test('payload no-objeto lanza', () => {
  assert.throws(() => validateEventInput({ kind: 'x', agentId: 'a', payload: 's' }), (e) => e instanceof PostalError && e.code === 'invalid_input');
});
test('payload undefined permitido', () => {
  assert.ok(validateEventInput({ kind: 'x', agentId: 'a' }));
});
