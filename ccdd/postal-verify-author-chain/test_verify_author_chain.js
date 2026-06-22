'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { verifyAuthorChain, eventHash } = require('../../lib/postal');

function ev(seq, prev, extra) { return Object.assign({ from: 'a', seq, prev, kind: 'agent.message', body: {}, created_at: '2026-01-01T00:00:00.000Z', id: 'id' + seq, to: [], v: 1, sig: null }, extra || {}); }

test('cadena valida -> sin fallos', async () => {
  const e0 = ev(0, null);
  const e1 = ev(1, await eventHash(e0));
  const f = await verifyAuthorChain('a', [e1, e0]);
  assert.strictEqual(f.length, 0);
});
test('gap detectado', async () => {
  const e0 = ev(0, null);
  const e2 = ev(2, null);
  const f = await verifyAuthorChain('a', [e0, e2]);
  assert.ok(f.length >= 1);
  assert.ok(f[0].reasons.some((r) => r.indexOf('chain-gap') === 0));
});
test('prev mismatch detectado', async () => {
  const e0 = ev(0, null);
  const e1 = ev(1, 'wronghash');
  const f = await verifyAuthorChain('a', [e0, e1]);
  assert.ok(f.some((x) => x.reasons.includes('chain-prev-mismatch')));
});
test('no muta la lista de entrada', async () => {
  const e0 = ev(0, null);
  const list = [e0];
  await verifyAuthorChain('a', list);
  assert.strictEqual(list[0], e0);
});
