'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { verifyChains, eventHash, canonical } = require('../../lib/postal');

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

function ev(from, seq, prev) { return { from, seq, prev, kind: 'agent.message', body: {}, created_at: '2026-01-01T00:00:00.000Z', id: from + seq, to: [], v: 1, sig: null }; }

async function genKp() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    privateKeyJwk: await subtle.exportKey('jwk', kp.privateKey),
    publicKeyJwk: await subtle.exportKey('jwk', kp.publicKey)
  };
}

async function signIndependent(e, privJwk) {
  const k = await subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const { sig, ...rest } = e;
  const s = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, enc.encode(canonical(rest)));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Helpers de ledger temporal
function entry(pub, activatedAt, status, supersededAt, revokedAt) {
    return { publicJwk: pub, activated_at: activatedAt, status: status || 'active', superseded_at: supersededAt || null, revoked_at: revokedAt || null };
}
function ledgerFor(keys) { return new Map([['a', { agentId: 'a', keys }]]); }

const T0 = '2026-01-01T00:00:00.000Z';
const ROT_AT = '2026-02-01T00:00:00.000Z';
const REV_AT = '2026-03-01T00:00:00.000Z';
const AFTER_ROT = '2026-02-15T00:00:00.000Z';
const AFTER_REV = '2026-04-01T00:00:00.000Z';

test('eventos sin seq se ignoran', async () => {
  const f = await verifyChains([{ from: 'a', kind: 'x' }]);
  assert.strictEqual(f.length, 0);
});
test('autores buenos no fallan', async () => {
  const e0 = ev('a', 0, null);
  const e1 = ev('a', 1, await eventHash(e0));
  const f = await verifyChains([e0, e1]);
  assert.strictEqual(f.length, 0);
});
test('autor roto aislado', async () => {
  const a0 = ev('a', 0, null);
  const a1 = ev('a', 1, await eventHash(a0));
  const b0 = ev('b', 0, null);
  const b2 = ev('b', 2, 'wrong');
  const f = await verifyChains([a0, a1, b0, b2]);
  assert.ok(f.every((x) => x.from === 'b'));
  assert.ok(f.length >= 1);
});
test('backward-compat: sin identities, eventos sig:null no fallan por firma', async () => {
  const e0 = ev('a', 0, null);
  const f = await verifyChains([e0]);
  assert.strictEqual(f.length, 0);
});
test('con identities y firma valida: no falla', async () => {
  const kp = await genKp();
  const e0 = ev('a', 0, null);
  e0.sig = await signIndependent(e0, kp.privateKeyJwk);
  const map = new Map([['a', kp.publicKeyJwk]]);
  const f = await verifyChains([e0], map);
  assert.strictEqual(f.length, 0);
});
test('con identities y body manipulado: bad-signature', async () => {
  const kp = await genKp();
  const e0 = ev('a', 0, null);
  e0.sig = await signIndependent(e0, kp.privateKeyJwk);
  e0.body = { text: 'manipulado' };
  const map = new Map([['a', kp.publicKeyJwk]]);
  const f = await verifyChains([e0], map);
  assert.ok(f.some((x) => x.from === 'a' && x.reasons.includes('bad-signature')));
});

// --- Temporal (keyLedger) ---
test('temporal: clave activa en ventana -> []', async () => {
  const g = await genKp();
  const e0 = ev('a', 0, null);
  e0.created_at = AFTER_ROT;
  e0.sig = await signIndependent(e0, g.privateKeyJwk);
  const f = await verifyChains([e0], null, ledgerFor([entry(g.publicKeyJwk, T0)]));
  assert.strictEqual(f.length, 0);
});
test('temporal: clave rotada y t>superseded_at -> stale-key', async () => {
  const g = await genKp();
  const n = await genKp();
  const e0 = ev('a', 0, null);
  e0.created_at = AFTER_ROT;
  e0.sig = await signIndependent(e0, g.privateKeyJwk);
  const keys = [
    entry(g.publicKeyJwk, T0, 'rotated', ROT_AT, null),
    entry(n.publicKeyJwk, ROT_AT, 'active', null, null)
  ];
  const f = await verifyChains([e0], null, ledgerFor(keys));
  assert.ok(f.some((x) => x.from === 'a' && x.reasons.includes('stale-key')));
});
test('temporal: clave revocada y t>revoked_at -> revoked-key', async () => {
  const g = await genKp();
  const e0 = ev('a', 0, null);
  e0.created_at = AFTER_REV;
  e0.sig = await signIndependent(e0, g.privateKeyJwk);
  const f = await verifyChains([e0], null, ledgerFor([entry(g.publicKeyJwk, T0, 'revoked', null, REV_AT)]));
  assert.ok(f.some((x) => x.from === 'a' && x.reasons.includes('revoked-key')));
});