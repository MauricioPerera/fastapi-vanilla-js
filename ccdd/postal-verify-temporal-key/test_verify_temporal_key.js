'use strict';
// Oraculo independiente para verifyTemporalKey (puro).
const test = require('node:test');
const assert = require('node:assert');
const { verifyTemporalKey } = require('../../lib/postal');

function entry(activatedAt, supersededAt, revokedAt, status) {
    return { publicJwk: { kty: 'EC' }, activated_at: activatedAt, status: status || 'active', superseded_at: supersededAt || null, revoked_at: revokedAt || null };
}

test('revocada y t > revoked_at -> revoked-key', () => {
    const e = entry('2026-01-01T00:00:00.000Z', null, '2026-01-15T00:00:00.000Z', 'revoked');
    assert.deepStrictEqual(verifyTemporalKey(e, '2026-02-01T00:00:00.000Z'), ['revoked-key']);
});

test('revocada y t == revoked_at -> [] (borde valido)', () => {
    const e = entry('2026-01-01T00:00:00.000Z', null, '2026-01-15T00:00:00.000Z', 'revoked');
    assert.deepStrictEqual(verifyTemporalKey(e, '2026-01-15T00:00:00.000Z'), []);
});

test('rotada y t > superseded_at -> stale-key', () => {
    const e = entry('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', null, 'rotated');
    assert.deepStrictEqual(verifyTemporalKey(e, '2026-03-01T00:00:00.000Z'), ['stale-key']);
});

test('rotada y t == superseded_at -> [] (borde valido)', () => {
    const e = entry('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', null, 'rotated');
    assert.deepStrictEqual(verifyTemporalKey(e, '2026-02-01T00:00:00.000Z'), []);
});

test('t < activated_at -> future-key', () => {
    const e = entry('2026-02-01T00:00:00.000Z', null, null, 'active');
    assert.deepStrictEqual(verifyTemporalKey(e, '2026-01-01T00:00:00.000Z'), ['future-key']);
});

test('activa en ventana -> []', () => {
    const e = entry('2026-01-01T00:00:00.000Z', null, null, 'active');
    assert.deepStrictEqual(verifyTemporalKey(e, '2026-06-01T00:00:00.000Z'), []);
});

test('revocada+rotada y t > ambos -> revoked-key (precedencia)', () => {
    const e = entry('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 'revoked');
    assert.deepStrictEqual(verifyTemporalKey(e, '2026-04-01T00:00:00.000Z'), ['revoked-key']);
});

test('rotada pero no revocada, t entre superseded_at y futuro -> stale-key', () => {
    const e = entry('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', null, 'rotated');
    assert.deepStrictEqual(verifyTemporalKey(e, '2026-02-15T00:00:00.000Z'), ['stale-key']);
});