'use strict';
// Oraculo independiente para applyRotation: NO importa cripto del target; construye
// KeyStates a mano y verifica el fold puro.
const test = require('node:test');
const assert = require('node:assert');
const { applyRotation } = require('../../lib/postal');

function genesisState(agentId, publicJwk, activatedAt) {
    return {
        agentId,
        keys: [{
            publicJwk, activated_at: activatedAt, status: 'active',
            superseded_at: null, revoked_at: null
        }]
    };
}

function rotEv(newPublicJwk, createdAt, effectiveAt) {
    return {
        kind: 'identity.rotated', from: 'a', created_at: createdAt,
        body: effectiveAt ? { newPublicJwk, effective_at: effectiveAt } : { newPublicJwk }
    };
}

test('rotacion marca genesis rotated y agrega nueva active', () => {
    const gen = { kty: 'EC', x: 'g1', y: 'g1' };
    const neu = { kty: 'EC', x: 'n1', y: 'n1' };
    const state = genesisState('a', gen, '2026-01-01T00:00:00.000Z');
    const out = applyRotation(state, rotEv(neu, '2026-02-01T00:00:00.000Z'));
    assert.strictEqual(out.keys.length, 2);
    assert.strictEqual(out.keys[0].status, 'rotated');
    assert.strictEqual(out.keys[0].superseded_at, '2026-02-01T00:00:00.000Z');
    assert.strictEqual(out.keys[1].status, 'active');
    assert.strictEqual(out.keys[1].publicJwk, neu);
    assert.strictEqual(out.keys[1].activated_at, '2026-02-01T00:00:00.000Z');
    assert.strictEqual(out.keys[1].superseded_at, null);
    assert.strictEqual(out.keys[1].revoked_at, null);
});

test('effective_at default a ev.created_at', () => {
    const gen = { kty: 'EC', x: 'g1', y: 'g1' };
    const neu = { kty: 'EC', x: 'n1', y: 'n1' };
    const state = genesisState('a', gen, '2026-01-01T00:00:00.000Z');
    const out = applyRotation(state, rotEv(neu, '2026-02-01T00:00:00.000Z'));
    assert.strictEqual(out.keys[0].superseded_at, '2026-02-01T00:00:00.000Z');
    assert.strictEqual(out.keys[1].activated_at, '2026-02-01T00:00:00.000Z');
});

test('effective_at explicita respeta el valor', () => {
    const gen = { kty: 'EC', x: 'g1', y: 'g1' };
    const neu = { kty: 'EC', x: 'n1', y: 'n1' };
    const state = genesisState('a', gen, '2026-01-01T00:00:00.000Z');
    const out = applyRotation(state, rotEv(neu, '2026-02-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z'));
    assert.strictEqual(out.keys[0].superseded_at, '2026-02-02T00:00:00.000Z');
    assert.strictEqual(out.keys[1].activated_at, '2026-02-02T00:00:00.000Z');
});

test('sin clave activa -> sin cambios', () => {
    const neu = { kty: 'EC', x: 'n1', y: 'n1' };
    const state = { agentId: 'a', keys: [] };
    const out = applyRotation(state, rotEv(neu, '2026-02-01T00:00:00.000Z'));
    assert.strictEqual(out, state);
});

test('todas rotated/revoked -> sin cambios', () => {
    const neu = { kty: 'EC', x: 'n1', y: 'n1' };
    const state = {
        agentId: 'a',
        keys: [{ publicJwk: { kty: 'EC', x: 'g', y: 'g' }, activated_at: 't', status: 'rotated', superseded_at: 't2', revoked_at: null }]
    };
    const out = applyRotation(state, rotEv(neu, '2026-02-01T00:00:00.000Z'));
    assert.strictEqual(out.keys.length, 1);
});

test('no muta el input', () => {
    const gen = { kty: 'EC', x: 'g1', y: 'g1' };
    const neu = { kty: 'EC', x: 'n1', y: 'n1' };
    const state = genesisState('a', gen, '2026-01-01T00:00:00.000Z');
    const snapshot = JSON.parse(JSON.stringify(state));
    applyRotation(state, rotEv(neu, '2026-02-01T00:00:00.000Z'));
    assert.deepStrictEqual(state, snapshot);
});

test('preserva revoked_at de la clave previa al rotarla', () => {
    const gen = { kty: 'EC', x: 'g1', y: 'g1' };
    const neu = { kty: 'EC', x: 'n1', y: 'n1' };
    const state = {
        agentId: 'a',
        keys: [{ publicJwk: gen, activated_at: '2026-01-01T00:00:00.000Z', status: 'active', superseded_at: null, revoked_at: '2026-01-15T00:00:00.000Z' }]
    };
    const out = applyRotation(state, rotEv(neu, '2026-02-01T00:00:00.000Z'));
    assert.strictEqual(out.keys[0].revoked_at, '2026-01-15T00:00:00.000Z');
});