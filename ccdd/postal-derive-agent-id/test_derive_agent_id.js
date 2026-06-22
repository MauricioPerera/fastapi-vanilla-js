'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { deriveAgentId } = require('../../lib/postal');

const subtle = globalThis.crypto.subtle;

async function spki() {
    const kp = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const spkiBuf = await subtle.exportKey('spki', kp.publicKey);
    return { spkiBuf, pub: kp.publicKey };
}

function base64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

test('determinista: misma clave -> mismo agentId', async () => {
    const { spkiBuf } = await spki();
    const a = await deriveAgentId(spkiBuf);
    const b = await deriveAgentId(spkiBuf);
    assert.strictEqual(a, b);
});

test('charset base64url sin padding', async () => {
    const { spkiBuf } = await spki();
    const id = await deriveAgentId(spkiBuf);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(id), 'debe ser base64url sin padding: ' + id);
    assert.ok(!id.includes('='), 'no debe contener padding');
    assert.ok(id.length > 20, 'debe tener longitud razonable: ' + id);
});

test('dos claves distintas -> agentIds distintos', async () => {
    const a = await spki();
    const b = await spki();
    const idA = await deriveAgentId(a.spkiBuf);
    const idB = await deriveAgentId(b.spkiBuf);
    assert.notStrictEqual(idA, idB);
});

test('coincide con SHA-256 calculado con node crypto (oraculo independiente)', async () => {
    const { spkiBuf } = await spki();
    const id = await deriveAgentId(spkiBuf);
    const expected = base64url(crypto.createHash('sha256').update(Buffer.from(spkiBuf)).digest());
    assert.strictEqual(id, expected);
});

test('acepta Uint8Array como entrada', async () => {
    const { spkiBuf } = await spki();
    const u8 = new Uint8Array(spkiBuf);
    const id = await deriveAgentId(u8);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(id));
});