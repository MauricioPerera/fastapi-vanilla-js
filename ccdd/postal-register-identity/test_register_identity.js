'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { registerIdentity, deriveAgentId } = require('../../lib/postal');
const { RepoError: GR } = require('../../lib/gitRepos');

const subtle = globalThis.crypto.subtle;

async function genPubJwk() {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    return subtle.exportKey('jwk', kp.publicKey);
}

async function spkiOf(pubJwk) {
    const k = await subtle.importKey('jwk', pubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, []);
    return subtle.exportKey('spki', k);
}

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'postal-id-'));
}

function readRegistry(dir, repo) {
    return JSON.parse(fs.readFileSync(path.join(dir, repo + '.json'), 'utf8'));
}

test('registro inicial: agentId derivado, existed false, persiste', async () => {
    const dir = tmpDir();
    const jwk = await genPubJwk();
    const r = await registerIdentity('repo1', dir, jwk);
    assert.strictEqual(r.existed, false);
    assert.strictEqual(r.publicKeyJwk, jwk);
    const reg = readRegistry(dir, 'repo1');
    assert.strictEqual(reg.identities.length, 1);
    assert.strictEqual(reg.identities[0].agentId, r.agentId);
});

test('idempotente: misma clave no duplica, existed true', async () => {
    const dir = tmpDir();
    const jwk = await genPubJwk();
    const a = await registerIdentity('repo1', dir, jwk);
    const b = await registerIdentity('repo1', dir, jwk);
    assert.strictEqual(a.agentId, b.agentId);
    assert.strictEqual(a.existed, false);
    assert.strictEqual(b.existed, true);
    const reg = readRegistry(dir, 'repo1');
    assert.strictEqual(reg.identities.length, 1);
});

test('dos claves distintas -> dos entradas, agentIds distintos', async () => {
    const dir = tmpDir();
    const jA = await genPubJwk();
    const jB = await genPubJwk();
    const a = await registerIdentity('repo1', dir, jA);
    const b = await registerIdentity('repo1', dir, jB);
    assert.notStrictEqual(a.agentId, b.agentId);
    const reg = readRegistry(dir, 'repo1');
    assert.strictEqual(reg.identities.length, 2);
});

test('agentId coincide con deriveAgentId independiente (oraculo)', async () => {
    const dir = tmpDir();
    const jwk = await genPubJwk();
    const r = await registerIdentity('repo1', dir, jwk);
    const expected = await deriveAgentId(await spkiOf(jwk));
    assert.strictEqual(r.agentId, expected);
});

test('repo invalido lanza RepoError', async () => {
    const dir = tmpDir();
    const jwk = await genPubJwk();
    await assert.rejects(() => registerIdentity('../bad', dir, jwk), (e) => e instanceof GR || e.code === 'invalid_name');
});

test('append-only: registro previo preservado al agregar nuevo', async () => {
    const dir = tmpDir();
    const jA = await genPubJwk();
    const jB = await genPubJwk();
    await registerIdentity('repo1', dir, jA);
    await registerIdentity('repo1', dir, jB);
    const reg = readRegistry(dir, 'repo1');
    assert.strictEqual(reg.identities.length, 2);
    assert.deepStrictEqual(reg.identities[0].publicJwk, jA);
    assert.deepStrictEqual(reg.identities[1].publicJwk, jB);
});

test('repos aislados: archivos separados', async () => {
    const dir = tmpDir();
    const jwk = await genPubJwk();
    await registerIdentity('repoA', dir, jwk);
    await registerIdentity('repoB', dir, jwk);
    assert.ok(fs.existsSync(path.join(dir, 'repoA.json')));
    assert.ok(fs.existsSync(path.join(dir, 'repoB.json')));
});