'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { eventHash } = require('../../lib/postal');

test('devuelve 64 hex', async () => {
  const h = await eventHash({ a: 1 });
  assert.match(h, /^[0-9a-f]{64}$/);
});
test('determinista', async () => {
  assert.strictEqual(await eventHash({ a: 1, b: 2 }), await eventHash({ b: 2, a: 1 }));
});
test('sensible a cambios', async () => {
  assert.notStrictEqual(await eventHash({ a: 1 }), await eventHash({ a: 2 }));
});
