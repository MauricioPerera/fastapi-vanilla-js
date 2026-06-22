'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeEventId } = require('../../lib/postal');

test('reemplaza : y . por -', () => {
  assert.strictEqual(makeEventId('2026-01-02T03:04:05.678Z', 'alice', 'r1'), '2026-01-02T03-04-05-678Z_alice_r1');
});
test('formato createdAt_from_rnd', () => {
  assert.strictEqual(makeEventId('a.b:c', 'x', 'y'), 'a-b-c_x_y');
});
test('determinista', () => {
  assert.strictEqual(makeEventId('t', 'a', 'r'), makeEventId('t', 'a', 'r'));
});
