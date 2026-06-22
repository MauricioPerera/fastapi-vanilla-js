'use strict';
// Oraculo independiente para foldIdentityEvents: firma eventos de identidad con subtle
// directo sobre canonical(signedView(ev)), sin usar la firma del target.
const test = require('node:test');
const assert = require('node:assert');
const { foldIdentityEvents, canonical } = require('../../lib/postal');

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

async function genKp() {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    return {
        privateKeyJwk: await subtle.exportKey('jwk', kp.privateKey),
        publicKeyJwk: await subtle.exportKey('jwk', kp.publicKey)
    };
}

async function signAs(ev, privJwk) {
    const k = await subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const { sig, ...rest } = ev;
    const s = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, enc.encode(canonical(rest)));
    return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function idEvent(kind, createdAt, body, privJwk, seq) {
    const ev = {
        v: 1, kind, from: 'a', to: [],
        created_at: createdAt, id: 'a_' + seq, seq, prev: null, body, sig: null
    };
    ev.sig = await signAs(ev, privJwk);
    return ev;
}

function genesisEntry(pub, activatedAt) {
    return { agentId: 'a', publicJwk: pub, activated_at: activatedAt };
}

const ROT_AT = '2026-02-01T00:00:00.000Z';
const REV_AT = '2026-03-01T00:00:00.000Z';

test('solo genesis -> state con genesis active', async () => {
    const g = await genKp();
    const state = await foldIdentityEvents(genesisEntry(g.publicKeyJwk, '2026-01-01T00:00:00.000Z'), []);
    assert.strictEqual(state.keys.length, 1);
    assert.strictEqual(state.keys[0].status, 'active');
    assert.strictEqual(state.keys[0].publicJwk, g.publicKeyJwk);
});

test('rotacion firmada por genesis aplica', async () => {
    const g = await genKp();
    const n = await genKp();
    const ev = await idEvent('identity.rotated', ROT_AT,
        { newPublicJwk: n.publicKeyJwk, effective_at: ROT_AT }, g.privateKeyJwk, 1);
    const state = await foldIdentityEvents(genesisEntry(g.publicKeyJwk, '2026-01-01T00:00:00.000Z'), [ev]);
    assert.strictEqual(state.keys.length, 2);
    assert.strictEqual(state.keys[0].status, 'rotated');
    assert.strictEqual(state.keys[0].superseded_at, ROT_AT);
    assert.strictEqual(state.keys[1].status, 'active');
    assert.strictEqual(state.keys[1].publicJwk, n.publicKeyJwk);
});

test('rotacion firmada por clave equivocada -> break (solo genesis)', async () => {
    const g = await genKp();
    const n = await genKp();
    const otra = await genKp();
    const ev = await idEvent('identity.rotated', ROT_AT,
        { newPublicJwk: n.publicKeyJwk, effective_at: ROT_AT }, otra.privateKeyJwk, 1);
    const state = await foldIdentityEvents(genesisEntry(g.publicKeyJwk, '2026-01-01T00:00:00.000Z'), [ev]);
    assert.strictEqual(state.keys.length, 1);
    assert.strictEqual(state.keys[0].status, 'active');
    assert.strictEqual(state.keys[0].publicJwk, g.publicKeyJwk);
});

test('rotacion + revocacion firmada por la nueva activa -> nueva revoked', async () => {
    const g = await genKp();
    const n = await genKp();
    const rot = await idEvent('identity.rotated', ROT_AT,
        { newPublicJwk: n.publicKeyJwk, effective_at: ROT_AT }, g.privateKeyJwk, 1);
    const rev = await idEvent('identity.revoked', REV_AT,
        { revoked_at: REV_AT }, n.privateKeyJwk, 2);
    const state = await foldIdentityEvents(genesisEntry(g.publicKeyJwk, '2026-01-01T00:00:00.000Z'), [rot, rev]);
    assert.strictEqual(state.keys.length, 2);
    assert.strictEqual(state.keys[1].status, 'revoked');
    assert.strictEqual(state.keys[1].revoked_at, REV_AT);
});

test('rotacion con effective_at ausente -> applyRotation usa created_at', async () => {
    const g = await genKp();
    const n = await genKp();
    const ev = await idEvent('identity.rotated', ROT_AT,
        { newPublicJwk: n.publicKeyJwk }, g.privateKeyJwk, 1);
    const state = await foldIdentityEvents(genesisEntry(g.publicKeyJwk, '2026-01-01T00:00:00.000Z'), [ev]);
    assert.strictEqual(state.keys.length, 2);
    assert.strictEqual(state.keys[0].superseded_at, ROT_AT);
    assert.strictEqual(state.keys[1].activated_at, ROT_AT);
});

test('eventos desordenados por created_at se ordenan antes de plegar', async () => {
    const g = await genKp();
    const n = await genKp();
    const rot = await idEvent('identity.rotated', ROT_AT,
        { newPublicJwk: n.publicKeyJwk, effective_at: ROT_AT }, g.privateKeyJwk, 1);
    const rev = await idEvent('identity.revoked', REV_AT,
        { revoked_at: REV_AT }, n.privateKeyJwk, 2);
    // pasados en orden inverso
    const state = await foldIdentityEvents(genesisEntry(g.publicKeyJwk, '2026-01-01T00:00:00.000Z'), [rev, rot]);
    assert.strictEqual(state.keys.length, 2);
    assert.strictEqual(state.keys[1].status, 'revoked');
});