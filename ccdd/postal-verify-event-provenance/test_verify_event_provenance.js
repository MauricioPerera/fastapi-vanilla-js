'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { verifyEventProvenance, canonical } = require('../../lib/postal');

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

async function genKp() {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    return {
        privateKeyJwk: await subtle.exportKey('jwk', kp.privateKey),
        publicKeyJwk: await subtle.exportKey('jwk', kp.publicKey)
    };
}

// Oraculo independiente: firma con subtle.sign directo sobre canonical(signedView).
async function signIndependent(ev, privJwk) {
    const k = await subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const { sig, ...rest } = ev;
    const s = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, enc.encode(canonical(rest)));
    return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function baseEvent(from) {
    return {
        v: 1, kind: 'agent.message', from, to: [],
        created_at: '2026-01-01T00:00:00.000Z', id: from + '_0',
        seq: 0, prev: null, body: { text: 'hola' }, sig: null
    };
}

test('registered + firma valida -> []', async () => {
    const kp = await genKp();
    const ev = baseEvent('agentX');
    ev.sig = await signIndependent(ev, kp.privateKeyJwk);
    const map = new Map([['agentX', kp.publicKeyJwk]]);
    assert.deepStrictEqual(await verifyEventProvenance(ev, map), []);
});

test('registered + body manipulado -> [bad-signature]', async () => {
    const kp = await genKp();
    const ev = baseEvent('agentX');
    ev.sig = await signIndependent(ev, kp.privateKeyJwk);
    ev.body = { text: 'manipulado' };
    const map = new Map([['agentX', kp.publicKeyJwk]]);
    assert.deepStrictEqual(await verifyEventProvenance(ev, map), ['bad-signature']);
});

test('not registered + sig presente -> [unknown-author]', async () => {
    const kp = await genKp();
    const ev = baseEvent('fantasma');
    ev.sig = await signIndependent(ev, kp.privateKeyJwk);
    const map = new Map([['agentX', kp.publicKeyJwk]]);
    assert.deepStrictEqual(await verifyEventProvenance(ev, map), ['unknown-author']);
});

test('registered + sig null -> [unsigned-registered-author]', async () => {
    const kp = await genKp();
    const ev = baseEvent('agentX');
    const map = new Map([['agentX', kp.publicKeyJwk]]);
    assert.deepStrictEqual(await verifyEventProvenance(ev, map), ['unsigned-registered-author']);
});

test('not registered + sig null -> []', async () => {
    const ev = baseEvent('anonimo');
    const map = new Map([['agentX', { kty: 'EC' }]]);
    assert.deepStrictEqual(await verifyEventProvenance(ev, map), []);
});

test('identities undefined -> [] (legacy)', async () => {
    const ev = baseEvent('agentX');
    ev.sig = 'deadbeef';
    assert.deepStrictEqual(await verifyEventProvenance(ev, undefined), []);
});