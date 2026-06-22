'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { appendEvent, eventHash, eventFilePath, PostalError } = require('../../lib/postal');

async function tmp() { return fs.promises.mkdtemp(path.join(os.tmpdir(), 'postal-append-')); }

test('primer evento seq 0 prev null y persiste', async () => {
  const d = await tmp();
  try {
    const ev = await appendEvent('r', d, { kind: 'agent.message', agentId: 'alice', payload: { text: 'x' } });
    assert.strictEqual(ev.seq, 0);
    assert.strictEqual(ev.prev, null);
    assert.strictEqual(ev.sig, null);
    assert.strictEqual(ev.to.length, 0);
    const f = eventFilePath('r', ev, d);
    const onDisk = JSON.parse(await fs.promises.readFile(f, 'utf8'));
    assert.strictEqual(onDisk.id, ev.id);
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('segundo encadena seq 1 prev hash del primero', async () => {
  const d = await tmp();
  try {
    const e1 = await appendEvent('r', d, { kind: 'agent.message', agentId: 'alice', payload: { text: '1' } });
    const e2 = await appendEvent('r', d, { kind: 'agent.message', agentId: 'alice', payload: { text: '2' } });
    assert.strictEqual(e2.seq, 1);
    assert.strictEqual(e2.prev, await eventHash(e1));
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('cadenas independientes por autor', async () => {
  const d = await tmp();
  try {
    await appendEvent('r', d, { kind: 'agent.message', agentId: 'alice', payload: { text: '1' } });
    const b = await appendEvent('r', d, { kind: 'agent.message', agentId: 'bob', payload: { text: '1' } });
    assert.strictEqual(b.seq, 0);
    assert.strictEqual(b.prev, null);
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('to se ordena', async () => {
  const d = await tmp();
  try {
    const ev = await appendEvent('r', d, { kind: 'agent.message', agentId: 'alice', to: ['z', 'a'], payload: { text: 'x' } });
    assert.deepStrictEqual(ev.to, ['a', 'z']);
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('input invalido lanza invalid_input', async () => {
  const d = await tmp();
  try {
    await assert.rejects(() => appendEvent('r', d, { agentId: 'a' }), (e) => e instanceof PostalError && e.code === 'invalid_input');
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
