'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { readChainTip, appendEvent, eventHash } = require('../../lib/postal');

async function tmp() { return fs.promises.mkdtemp(path.join(os.tmpdir(), 'postal-tip-')); }

test('repo vacio -> seq 0 prev null', async () => {
  const d = await tmp();
  try { assert.deepStrictEqual(await readChainTip('r', d, 'alice'), { seq: 0, prev: null }); }
  finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('tras un evento -> seq 1 prev hash', async () => {
  const d = await tmp();
  try {
    const ev = await appendEvent('r', d, { kind: 'agent.message', agentId: 'alice', payload: { text: 'x' } });
    const tip = await readChainTip('r', d, 'alice');
    assert.strictEqual(tip.seq, 1);
    assert.strictEqual(tip.prev, await eventHash(ev));
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('independiente entre autores', async () => {
  const d = await tmp();
  try {
    await appendEvent('r', d, { kind: 'agent.message', agentId: 'alice', payload: { text: 'x' } });
    assert.deepStrictEqual(await readChainTip('r', d, 'bob'), { seq: 0, prev: null });
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
