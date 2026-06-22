'use strict';
// Oraculo independiente para applyRevocation (fold puro, sin cripto del target).
const test = require('node:test');
const assert = require('node:assert');
const { applyRevocation } = require('../../lib/postal');

function state(keys) { return { agentId: 'a', keys }; }
function active(pub, at) { return { publicJwk: pub, activated_at: at, status: 'active', superseded_at: null, revoked_at: null }; }
function revEv(createdAt, body) { return { kind: 'identity.revoked', from: 'a', created_at: createdAt, body: body || {} }; }

test('revoca la activa cuando no hay target', () => {
    const s = state([active({ kty: 'EC', x: 'g', y: 'g' }, '2026-01-01T00:00:00.000Z')]);
    const out = applyRevocation(s, revEv('2026-02-01T00:00:00.000Z', { revoked_at: '2026-02-01T00:00:00.000Z' }));
    assert.strictEqual(out.keys[0].status, 'revoked');
    assert.strictEqual(out.keys[0].revoked_at, '2026-02-01T00:00:00.000Z');
});

test('revoked_at default a ev.created_at', () => {
    const s = state([active({ kty: 'EC', x: 'g', y: 'g' }, '2026-01-01T00:00:00.000Z')]);
    const out = applyRevocation(s, revEv('2026-03-01T00:00:00.000Z'));
    assert.strictEqual(out.keys[0].revoked_at, '2026-03-01T00:00:00.000Z');
});

test('revoca target especifico por targetPublicJwk', () => {
    const g = { kty: 'EC', x: 'g', y: 'g' };
    const n = { kty: 'EC', x: 'n', y: 'n' };
    const s = state([
        { publicJwk: g, activated_at: 't1', status: 'rotated', superseded_at: 't2', revoked_at: null },
        active(n, 't2')
    ]);
    // Se targetea explicitamente la clave activa (n) por su publicJwk.
    const out = applyRevocation(s, revEv('2026-04-01T00:00:00.000Z', { targetPublicJwk: n, revoked_at: '2026-04-01T00:00:00.000Z' }));
    assert.strictEqual(out.keys[1].status, 'revoked');
    assert.strictEqual(out.keys[1].revoked_at, '2026-04-01T00:00:00.000Z');
    assert.strictEqual(out.keys[0].status, 'rotated'); // la rotada intacta
});

test('idempotente: ya revocada -> sin cambios', () => {
    const s = state([{ publicJwk: { kty: 'EC', x: 'g', y: 'g' }, activated_at: 't1', status: 'revoked', superseded_at: null, revoked_at: '2026-01-15T00:00:00.000Z' }]);
    const out = applyRevocation(s, revEv('2026-02-01T00:00:00.000Z'));
    assert.strictEqual(out, s);
});

test('target inexistente -> sin cambios', () => {
    const s = state([active({ kty: 'EC', x: 'g', y: 'g' }, 't1')]);
    const out = applyRevocation(s, revEv('2026-02-01T00:00:00.000Z', { targetPublicJwk: { kty: 'EC', x: 'zzz', y: 'zzz' } }));
    assert.strictEqual(out, s);
});

test('sin clave activa y sin target -> sin cambios', () => {
    const s = state([]);
    const out = applyRevocation(s, revEv('2026-02-01T00:00:00.000Z'));
    assert.strictEqual(out, s);
});

test('no muta el input', () => {
    const s = state([active({ kty: 'EC', x: 'g', y: 'g' }, '2026-01-01T00:00:00.000Z')]);
    const snap = JSON.parse(JSON.stringify(s));
    applyRevocation(s, revEv('2026-02-01T00:00:00.000Z', { revoked_at: '2026-02-01T00:00:00.000Z' }));
    assert.deepStrictEqual(s, snap);
});