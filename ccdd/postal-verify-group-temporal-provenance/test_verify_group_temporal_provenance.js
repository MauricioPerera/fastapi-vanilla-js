'use strict';
// Oraculo independiente para verifyGroupTemporalProvenance: firma con subtle directo sobre
// canonical(signedView(ev)), construye KeyState manualmente.
const test = require('node:test');
const assert = require('node:assert');
const { verifyGroupTemporalProvenance, canonical } = require('../../lib/postal');

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

async function msgEvent(from, createdAt, privJwk, seq) {
    const ev = {
        v: 1, kind: 'agent.message', from, to: [],
        created_at: createdAt, id: from + '_' + seq, seq, prev: null,
        body: { text: 'hola' }, sig: null
    };
    ev.sig = await signAs(ev, privJwk);
    return ev;
}

function keyState(keys) { return { agentId: 'a', keys }; }
function entry(pub, activatedAt, status, supersededAt, revokedAt) {
    return { publicJwk: pub, activated_at: activatedAt, status: status || 'active', superseded_at: supersededAt || null, revoked_at: revokedAt || null };
}

const T0 = '2026-01-01T00:00:00.000Z';
const ROT_AT = '2026-02-01T00:00:00.000Z';
const REV_AT = '2026-03-01T00:00:00.000Z';
const AFTER_ROT = '2026-02-15T00:00:00.000Z';
const AFTER_REV = '2026-04-01T00:00:00.000Z';

function singleLedger(keys) { return new Map([['a', keyState(keys)]]); }
const active1 = (pub) => [entry(pub, T0)];

test('evento activo en ventana -> sin fallos', async () => {
    const g = await genKp();
    const ev = await msgEvent('a', AFTER_ROT, g.privateKeyJwk, 1);
    const f = await verifyGroupTemporalProvenance('a', [ev], singleLedger(active1(g.publicKeyJwk)));
    assert.deepStrictEqual(f, []);
});

test('clave rotada y t>superseded_at -> stale-key', async () => {
    const g = await genKp();
    const n = await genKp();
    const ev = await msgEvent('a', AFTER_ROT, g.privateKeyJwk, 1);
    const keys = [
        entry(g.publicKeyJwk, T0, 'rotated', ROT_AT, null),
        entry(n.publicKeyJwk, ROT_AT, 'active', null, null)
    ];
    const f = await verifyGroupTemporalProvenance('a', [ev], singleLedger(keys));
    assert.strictEqual(f.length, 1);
    assert.strictEqual(f[0].from, 'a');
    assert.ok(f[0].reasons.includes('stale-key'));
});

test('clave revocada y t>revoked_at -> revoked-key', async () => {
    const g = await genKp();
    const ev = await msgEvent('a', AFTER_REV, g.privateKeyJwk, 1);
    const keys = [entry(g.publicKeyJwk, T0, 'revoked', null, REV_AT)];
    const f = await verifyGroupTemporalProvenance('a', [ev], singleLedger(keys));
    assert.strictEqual(f.length, 1);
    assert.ok(f[0].reasons.includes('revoked-key'));
});

test('lista vacia -> []', async () => {
    const g = await genKp();
    const f = await verifyGroupTemporalProvenance('a', [], singleLedger(active1(g.publicKeyJwk)));
    assert.deepStrictEqual(f, []);
});