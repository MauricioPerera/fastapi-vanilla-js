'use strict';
// Oraculo independiente para resolveActiveKeyAt (puro, sin cripto).
const test = require('node:test');
const assert = require('node:assert');
const { resolveActiveKeyAt } = require('../../lib/postal');

function key(pub, activatedAt, status, supersededAt, revokedAt) {
    return { publicJwk: pub, activated_at: activatedAt, status, superseded_at: supersededAt, revoked_at: revokedAt };
}

test('genesis vigente antes de la rotacion', () => {
    const g = { kty: 'EC', x: 'g', y: 'g' };
    const state = { agentId: 'a', keys: [key(g, '2026-01-01T00:00:00.000Z', 'active', null, null)] };
    const k = resolveActiveKeyAt(state, '2026-01-15T00:00:00.000Z');
    assert.ok(k);
    assert.strictEqual(k.publicJwk, g);
});

test('nueva vigente despues de la rotacion', () => {
    const g = { kty: 'EC', x: 'g', y: 'g' };
    const n = { kty: 'EC', x: 'n', y: 'n' };
    const state = { agentId: 'a', keys: [
        key(g, '2026-01-01T00:00:00.000Z', 'rotated', '2026-02-01T00:00:00.000Z', null),
        key(n, '2026-02-01T00:00:00.000Z', 'active', null, null)
    ]};
    const k = resolveActiveKeyAt(state, '2026-03-01T00:00:00.000Z');
    assert.ok(k);
    assert.strictEqual(k.publicJwk, n);
});

test('antes de la rotacion sigue vigente la genesis', () => {
    const g = { kty: 'EC', x: 'g', y: 'g' };
    const n = { kty: 'EC', x: 'n', y: 'n' };
    const state = { agentId: 'a', keys: [
        key(g, '2026-01-01T00:00:00.000Z', 'rotated', '2026-02-01T00:00:00.000Z', null),
        key(n, '2026-02-01T00:00:00.000Z', 'active', null, null)
    ]};
    const k = resolveActiveKeyAt(state, '2026-01-15T00:00:00.000Z');
    assert.ok(k);
    assert.strictEqual(k.publicJwk, g);
});

test('revocada -> null para t posterior a revoked_at', () => {
    const g = { kty: 'EC', x: 'g', y: 'g' };
    const state = { agentId: 'a', keys: [key(g, '2026-01-01T00:00:00.000Z', 'revoked', null, '2026-01-15T00:00:00.000Z')] };
    const k = resolveActiveKeyAt(state, '2026-02-01T00:00:00.000Z');
    assert.strictEqual(k, null);
});

test('revocada -> vigente para t anterior a revoked_at', () => {
    const g = { kty: 'EC', x: 'g', y: 'g' };
    const state = { agentId: 'a', keys: [key(g, '2026-01-01T00:00:00.000Z', 'revoked', null, '2026-01-15T00:00:00.000Z')] };
    const k = resolveActiveKeyAt(state, '2026-01-10T00:00:00.000Z');
    assert.ok(k);
    assert.strictEqual(k.publicJwk, g);
});

test('borde: t == superseded_at cae del lado de la nueva', () => {
    const g = { kty: 'EC', x: 'g', y: 'g' };
    const n = { kty: 'EC', x: 'n', y: 'n' };
    const state = { agentId: 'a', keys: [
        key(g, '2026-01-01T00:00:00.000Z', 'rotated', '2026-02-01T00:00:00.000Z', null),
        key(n, '2026-02-01T00:00:00.000Z', 'active', null, null)
    ]};
    const k = resolveActiveKeyAt(state, '2026-02-01T00:00:00.000Z');
    assert.ok(k, 'debe resolver una clave en el borde');
    assert.strictEqual(k.publicJwk, n);
});

test('sin claves -> null', () => {
    const state = { agentId: 'a', keys: [] };
    assert.strictEqual(resolveActiveKeyAt(state, '2026-01-01T00:00:00.000Z'), null);
});

test('t anterior a toda activated_at -> null', () => {
    const g = { kty: 'EC', x: 'g', y: 'g' };
    const state = { agentId: 'a', keys: [key(g, '2026-02-01T00:00:00.000Z', 'active', null, null)] };
    assert.strictEqual(resolveActiveKeyAt(state, '2026-01-01T00:00:00.000Z'), null);
});