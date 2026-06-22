'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { verifyEventSignature, canonical } = require('../../lib/postal');

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

async function genKp() {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const privateKeyJwk = await subtle.exportKey('jwk', kp.privateKey);
    const publicKeyJwk = await subtle.exportKey('jwk', kp.publicKey);
    return { privateKeyJwk, publicKeyJwk };
}

// Oraculo independiente: firma con subtle.sign directo sobre canonical(signedView),
// sin usar signEvent del target. Devuelve sig en hex (mismo formato que el target).
async function signIndependent(ev, privJwk) {
    const k = await subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const { sig, ...rest } = ev;
    const bytes = enc.encode(canonical(rest));
    const s = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, bytes);
    return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function baseEvent() {
    return {
        v: 1, kind: 'agent.message', from: 'a', to: [],
        created_at: '2026-01-01T00:00:00.000Z', id: 'a_0',
        seq: 0, prev: null, body: { text: 'hola' }, sig: null
    };
}

test('round-trip valido -> true', async () => {
    const kp = await genKp();
    const ev = baseEvent();
    ev.sig = await signIndependent(ev, kp.privateKeyJwk);
    assert.strictEqual(await verifyEventSignature(ev, kp.publicKeyJwk), true);
});

test('body manipulado -> false', async () => {
    const kp = await genKp();
    const ev = baseEvent();
    ev.sig = await signIndependent(ev, kp.privateKeyJwk);
    ev.body = { text: 'manipulado' };
    assert.strictEqual(await verifyEventSignature(ev, kp.publicKeyJwk), false);
});

test('clave publica distinta -> false', async () => {
    const kpA = await genKp();
    const kpB = await genKp();
    const ev = baseEvent();
    ev.sig = await signIndependent(ev, kpA.privateKeyJwk);
    assert.strictEqual(await verifyEventSignature(ev, kpB.publicKeyJwk), false);
});

test('sig null -> false', async () => {
    const kp = await genKp();
    const ev = baseEvent();
    assert.strictEqual(await verifyEventSignature(ev, kp.publicKeyJwk), false);
});

test('sig malformado (no hex) -> false', async () => {
    const kp = await genKp();
    const ev = baseEvent();
    ev.sig = 'no-es-hex!!';
    assert.strictEqual(await verifyEventSignature(ev, kp.publicKeyJwk), false);
});

test('sig truncada -> false', async () => {
    const kp = await genKp();
    const ev = baseEvent();
    ev.sig = await signIndependent(ev, kp.privateKeyJwk);
    ev.sig = ev.sig.slice(0, ev.sig.length - 4);
    assert.strictEqual(await verifyEventSignature(ev, kp.publicKeyJwk), false);
});

test('publicJwk ausente -> false', async () => {
    const kp = await genKp();
    const ev = baseEvent();
    ev.sig = await signIndependent(ev, kp.privateKeyJwk);
    assert.strictEqual(await verifyEventSignature(ev, null), false);
});