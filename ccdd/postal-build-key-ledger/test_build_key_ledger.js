'use strict';
// Oraculo independiente para buildKeyLedger: agrupa genesis + eventos firmados con subtle
// directo sobre canonical(signedView(ev)), sin usar la firma del target.
const test = require('node:test');
const assert = require('node:assert');
const { buildKeyLedger, canonical } = require('../../lib/postal');

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

async function idEvent(kind, createdAt, from, body, privJwk, seq) {
    const ev = {
        v: 1, kind, from, to: [],
        created_at: createdAt, id: from + '_' + seq, seq, prev: null, body, sig: null
    };
    ev.sig = await signAs(ev, privJwk);
    return ev;
}

const ROT_AT = '2026-02-01T00:00:00.000Z';

test('solo genesis -> state con genesis active', async () => {
    const g = await genKp();
    const identities = new Map([['a', { agentId: 'a', publicJwk: g.publicKeyJwk, activated_at: '2026-01-01T00:00:00.000Z' }]]);
    const ledger = await buildKeyLedger(identities, []);
    assert.strictEqual(ledger.size, 1);
    assert.strictEqual(ledger.get('a').keys.length, 1);
    assert.strictEqual(ledger.get('a').keys[0].status, 'active');
});

test('genesis + rotacion -> 2 claves', async () => {
    const g = await genKp();
    const n = await genKp();
    const identities = new Map([['a', { agentId: 'a', publicJwk: g.publicKeyJwk, activated_at: '2026-01-01T00:00:00.000Z' }]]);
    const rot = await idEvent('identity.rotated', ROT_AT, 'a', { newPublicJwk: n.publicKeyJwk, effective_at: ROT_AT }, g.privateKeyJwk, 1);
    const ledger = await buildKeyLedger(identities, [rot]);
    assert.strictEqual(ledger.get('a').keys.length, 2);
    assert.strictEqual(ledger.get('a').keys[1].status, 'active');
    assert.strictEqual(ledger.get('a').keys[1].publicJwk, n.publicKeyJwk);
});

test('agente no registrado ignorado', async () => {
    const g = await genKp();
    const n = await genKp();
    const identities = new Map([['a', { agentId: 'a', publicJwk: g.publicKeyJwk, activated_at: '2026-01-01T00:00:00.000Z' }]]);
    const rot = await idEvent('identity.rotated', ROT_AT, 'z', { newPublicJwk: n.publicKeyJwk, effective_at: ROT_AT }, g.privateKeyJwk, 1);
    const ledger = await buildKeyLedger(identities, [rot]);
    assert.strictEqual(ledger.size, 1);
    assert.strictEqual(ledger.has('z'), false);
});

test('dos agentes cada uno con su estado', async () => {
    const ga = await genKp();
    const gb = await genKp();
    const nb = await genKp();
    const identities = new Map([
        ['a', { agentId: 'a', publicJwk: ga.publicKeyJwk, activated_at: '2026-01-01T00:00:00.000Z' }],
        ['b', { agentId: 'b', publicJwk: gb.publicKeyJwk, activated_at: '2026-01-01T00:00:00.000Z' }]
    ]);
    const rotb = await idEvent('identity.rotated', ROT_AT, 'b', { newPublicJwk: nb.publicKeyJwk, effective_at: ROT_AT }, gb.privateKeyJwk, 1);
    const ledger = await buildKeyLedger(identities, [rotb]);
    assert.strictEqual(ledger.get('a').keys.length, 1);
    assert.strictEqual(ledger.get('b').keys.length, 2);
    assert.strictEqual(ledger.get('b').keys[1].publicJwk, nb.publicKeyJwk);
});

test('identities vacio -> Map vacio', async () => {
    const ledger = await buildKeyLedger(new Map(), []);
    assert.strictEqual(ledger.size, 0);
});