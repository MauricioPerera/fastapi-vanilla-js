'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { replayEvents, appendEvent, registerIdentity, eventFilePath } = require('../../lib/postal');

const subtle = globalThis.crypto.subtle;

async function tmp() { return fs.promises.mkdtemp(path.join(os.tmpdir(), 'postal-replay-')); }

async function genKp() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { privateKeyJwk: await subtle.exportKey('jwk', kp.privateKey), publicKeyJwk: await subtle.exportKey('jwk', kp.publicKey) };
}

test('repo vacio -> estado vacio y timeline vacia', async () => {
  const d = await tmp();
  try {
    const r = await replayEvents('r', d);
    assert.deepStrictEqual(r.state, { issues: {}, pulls: {}, workflows: {}, runs: {}, messages: [], counts: {} });
    assert.strictEqual(r.timeline.length, 0);
    assert.strictEqual(r.total, 0);
    assert.strictEqual(r.verified, 0);
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('pliega issue.created y agent.message', async () => {
  const d = await tmp();
  try {
    await appendEvent('r', d, { kind: 'issue.created', agentId: 'alice', payload: { number: 1, title: 't' } });
    await appendEvent('r', d, { kind: 'agent.message', agentId: 'bob', payload: { text: 'hola' } });
    const r = await replayEvents('r', d);
    assert.ok(r.state.issues['1']);
    assert.strictEqual(r.state.messages.length, 1);
    assert.strictEqual(r.timeline.length, 2);
    assert.strictEqual(r.verified, 2);
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('excluye eventos de cadena rota del estado', async () => {
  const d = await tmp();
  try {
    const e1 = await appendEvent('r', d, { kind: 'issue.created', agentId: 'alice', payload: { number: 1, title: 't' } });
    await appendEvent('r', d, { kind: 'issue.created', agentId: 'alice', payload: { number: 2, title: 'u' } });
    // borrar el evento medio (rompe la cadena del autor)
    const f = path.join(d, 'r', '2026'); // noop: solo para asegurar require de path
    void f;
    // forzar ruptura: escribir un evento con seq salteado directamente
    const fs2 = require('fs');
    const badPath = require('path').join(d, 'r', '2026', '01', '01', 'bad.json');
    await fs2.promises.mkdir(require('path').dirname(badPath), { recursive: true });
    await fs2.promises.writeFile(badPath, JSON.stringify({ v: 1, kind: 'issue.created', from: 'alice', to: [], created_at: '2026-01-01T00:00:00.000Z', id: 'bad', seq: 9, prev: 'wrong', body: { number: 9, title: 'bad' }, sig: null }), 'utf8');
    const r = await replayEvents('r', d);
    assert.ok(r.failures.length >= 1);
    assert.ok(!r.state.issues['9']);
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('pliega pr.created y run.started/completed en pulls y runs', async () => {
  const d = await tmp();
  try {
    await appendEvent('r', d, { kind: 'pr.created', agentId: 'alice', payload: { number: 1, title: 't', state: 'open', head: 'feat', base: 'main' } });
    await appendEvent('r', d, { kind: 'run.started', agentId: 'bob', payload: { runId: 'r1', workflow: 'ci', event: 'manual' } });
    await appendEvent('r', d, { kind: 'run.completed', agentId: 'bob', payload: { runId: 'r1', status: 'success', exitCode: 0 } });
    const r = await replayEvents('r', d);
    assert.ok(r.state.pulls['1'], 'pull proyectado');
    assert.strictEqual(r.state.pulls['1'].mergeCommitSha, null);
    assert.ok(r.state.runs['r1'], 'run proyectado');
    assert.strictEqual(r.state.runs['r1'].status, 'success');
    assert.strictEqual(r.state.runs['r1'].exitCode, 0);
    assert.strictEqual(r.timeline.length, 3);
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); }
});
test('con identitiesDir: evento firmado valido se proyecta', async () => {
  const d = await tmp();
  const idDir = await tmp();
  try {
    const kp = await genKp();
    const reg = await registerIdentity('r', idDir, kp.publicKeyJwk);
    await appendEvent('r', d, { kind: 'issue.created', agentId: reg.agentId, payload: { number: 1, title: 't' }, identity: { signPrivateJwk: kp.privateKeyJwk } });
    const r = await replayEvents('r', d, idDir);
    assert.strictEqual(r.verified, 1);
    assert.ok(r.state.issues['1']);
    assert.strictEqual(r.failures.length, 0);
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); await fs.promises.rm(idDir, { recursive: true, force: true }); }
});
test('con identitiesDir: body manipulado -> bad-signature excluido del estado', async () => {
  const d = await tmp();
  const idDir = await tmp();
  try {
    const kp = await genKp();
    const reg = await registerIdentity('r', idDir, kp.publicKeyJwk);
    const ev = await appendEvent('r', d, { kind: 'issue.created', agentId: reg.agentId, payload: { number: 1, title: 't' }, identity: { signPrivateJwk: kp.privateKeyJwk } });
    // manipular el body del evento en disco (rompe la firma sin romper la cadena)
    const file = eventFilePath('r', ev, d);
    const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
    tampered.body = { number: 1, title: 'MANIPULADO' };
    fs.writeFileSync(file, JSON.stringify(tampered, null, 2), 'utf8');
    const r = await replayEvents('r', d, idDir);
    assert.ok(r.failures.some((f) => f.reasons.includes('bad-signature')));
    assert.strictEqual(r.verified, 0);
    assert.ok(!r.state.issues['1']);
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); await fs.promises.rm(idDir, { recursive: true, force: true }); }
});

function later(iso, ms) { return new Date(new Date(iso).getTime() + ms).toISOString(); }

test('temporal: evento firmado por clave nueva tras rotacion se proyecta', async () => {
  const d = await tmp();
  const idDir = await tmp();
  try {
    const g = await genKp(); const n = await genKp();
    const reg = await registerIdentity('r', idDir, g.publicKeyJwk);
    const rot = await appendEvent('r', d, { kind: 'identity.rotated', agentId: reg.agentId, payload: { newPublicJwk: n.publicKeyJwk }, identity: { signPrivateJwk: g.privateKeyJwk } });
    await appendEvent('r', d, { kind: 'issue.created', agentId: reg.agentId, payload: { number: 1, title: 't' }, created_at: later(rot.created_at, 1000), identity: { signPrivateJwk: n.privateKeyJwk } });
    const r = await replayEvents('r', d, idDir);
    assert.ok(r.state.issues['1'], 'issue firmado por la clave nueva se proyecta');
    assert.ok(!r.failures.some((f) => f.reasons.includes('stale-key') || f.reasons.includes('revoked-key')));
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); await fs.promises.rm(idDir, { recursive: true, force: true }); }
});

test('temporal: evento firmado por clave vieja tras rotacion -> stale-key excluido', async () => {
  const d = await tmp();
  const idDir = await tmp();
  try {
    const g = await genKp(); const n = await genKp();
    const reg = await registerIdentity('r', idDir, g.publicKeyJwk);
    const rot = await appendEvent('r', d, { kind: 'identity.rotated', agentId: reg.agentId, payload: { newPublicJwk: n.publicKeyJwk }, identity: { signPrivateJwk: g.privateKeyJwk } });
    await appendEvent('r', d, { kind: 'issue.created', agentId: reg.agentId, payload: { number: 2, title: 'stale' }, created_at: later(rot.created_at, 1000), identity: { signPrivateJwk: g.privateKeyJwk } });
    const r = await replayEvents('r', d, idDir);
    assert.ok(r.failures.some((f) => f.reasons.includes('stale-key')), 'el evento de la clave vieja es stale-key');
    assert.ok(!r.state.issues['2'], 'no se proyecta el evento de la clave vieja');
  } finally { await fs.promises.rm(d, { recursive: true, force: true }); await fs.promises.rm(idDir, { recursive: true, force: true }); }
});
