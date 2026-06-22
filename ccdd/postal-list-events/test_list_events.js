'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { listEvents, appendEvent } = require('../../lib/postal');

async function tmp() { return fs.promises.mkdtemp(path.join(os.tmpdir(), 'postal-list-')); }

test('repo vacio -> []', async () => {
  const d = await tmp();
  try { assert.deepStrictEqual(await listEvents('r', d), []); }
  finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('ordena por created_at', async () => {
  const d = await tmp();
  try {
    await appendEvent('r', d, { kind: 'agent.message', agentId: 'a', payload: { text: '1' }, created_at: '2026-01-02T00:00:00.000Z', rnd: 'r1' });
    await appendEvent('r', d, { kind: 'agent.message', agentId: 'a', payload: { text: '2' }, created_at: '2026-01-01T00:00:00.000Z', rnd: 'r2' });
    const list = await listEvents('r', d);
    assert.strictEqual(list[0].body.text, '2');
    assert.strictEqual(list[1].body.text, '1');
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('filtro por kind', async () => {
  const d = await tmp();
  try {
    await appendEvent('r', d, { kind: 'issue.created', agentId: 'a', payload: { number: 1, title: 't' } });
    await appendEvent('r', d, { kind: 'agent.message', agentId: 'a', payload: { text: 'x' } });
    const list = await listEvents('r', d, { kind: 'issue.created' });
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].kind, 'issue.created');
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('filtro por from y since', async () => {
  const d = await tmp();
  try {
    await appendEvent('r', d, { kind: 'agent.message', agentId: 'a', payload: { text: 'x' }, created_at: '2026-01-01T00:00:00.000Z', rnd: 'r1' });
    await appendEvent('r', d, { kind: 'agent.message', agentId: 'b', payload: { text: 'y' }, created_at: '2026-02-01T00:00:00.000Z', rnd: 'r2' });
    assert.strictEqual((await listEvents('r', d, { from: 'a' })).length, 1);
    assert.strictEqual((await listEvents('r', d, { since: '2026-01-15T00:00:00.000Z' })).length, 1);
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
