'use strict';
// Oraculo independiente para verifyTemporalProvenance: firma eventos con subtle directo
// sobre canonical(signedView(ev)), construye KeyState manualmente, sin usar el target.
const test = require('node:test');
const assert = require('node:assert');
const { verifyTemporalProvenance, canonical } = require('../../lib/postal');

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

test('sin ledger -> [] (legacy)', async () => {
    const g = await genKp();
    const ev = await msgEvent('a', T0, g.privateKeyJwk, 1);
    assert.deepStrictEqual(await verifyTemporalProvenance(ev, null), []);
});

test('autor no registrado -> unknown-author', async () => {
    const g = await genKp();
    const ev = await msgEvent('z', T0, g.privateKeyJwk, 1);
    const ledger = new Map([['a', keyState([entry(g.publicKeyJwk, T0)])]]);
    assert.deepStrictEqual(await verifyTemporalProvenance(ev, ledger), ['unknown-author']);
});

test('autor no registrado SIN firma -> [] (anonimo-legacy admitido, ledger presente)', async () => {
    // REGRESION: un evento unsigned de autor desconocido (ej. issue.created from:'system')
    // debe ADMITIRSE con reasons [] para mantener compat hacia atras (iter 3 provenance).
    const g = await genKp();
    const ev = {
        v: 1, kind: 'issue.created', from: 'system', to: [],
        created_at: T0, id: 'system_1', seq: 1, prev: null,
        body: { number: 1, title: 'Bug', state: 'open' }, sig: null
    };
    const ledger = new Map([['a', keyState([entry(g.publicKeyJwk, T0)])]]);
    assert.deepStrictEqual(await verifyTemporalProvenance(ev, ledger), []);
});

test('autor no registrado SIN firma sobre ledger vacio -> [] (repo sin identidades)', async () => {
    // REGRESION: repo recien creado sin identidades registradas -> ledger vacio.
    // Evento system unsigned debe seguir admitido (timeline no vacio).
    const ev = {
        v: 1, kind: 'issue.created', from: 'system', to: [],
        created_at: T0, id: 'system_1', seq: 1, prev: null,
        body: { number: 1, title: 'Bug', state: 'open' }, sig: null
    };
    const ledger = new Map();
    assert.deepStrictEqual(await verifyTemporalProvenance(ev, ledger), []);
});

test('sin firma y registrado -> unsigned-registered-author', async () => {
    const g = await genKp();
    const ev = { v: 1, kind: 'agent.message', from: 'a', to: [], created_at: T0, id: 'a_1', seq: 1, prev: null, body: { text: 'hola' }, sig: null };
    const ledger = new Map([['a', keyState([entry(g.publicKeyJwk, T0)])]]);
    assert.deepStrictEqual(await verifyTemporalProvenance(ev, ledger), ['unsigned-registered-author']);
});

test('firma invalida -> bad-signature', async () => {
    const g = await genKp();
    const otra = await genKp();
    const ev = await msgEvent('a', T0, otra.privateKeyJwk, 1);
    const ledger = new Map([['a', keyState([entry(g.publicKeyJwk, T0)])]]);
    assert.deepStrictEqual(await verifyTemporalProvenance(ev, ledger), ['bad-signature']);
});

test('clave activa en ventana -> []', async () => {
    const g = await genKp();
    const ev = await msgEvent('a', AFTER_ROT, g.privateKeyJwk, 1);
    const ledger = new Map([['a', keyState([entry(g.publicKeyJwk, T0)])]]);
    assert.deepStrictEqual(await verifyTemporalProvenance(ev, ledger), []);
});

test('clave rotada y t>superseded_at -> stale-key', async () => {
    const g = await genKp();
    const n = await genKp();
    const ev = await msgEvent('a', AFTER_ROT, g.privateKeyJwk, 1);
    const ledger = new Map([['a', keyState([
        entry(g.publicKeyJwk, T0, 'rotated', ROT_AT, null),
        entry(n.publicKeyJwk, ROT_AT, 'active', null, null)
    ])]]);
    assert.deepStrictEqual(await verifyTemporalProvenance(ev, ledger), ['stale-key']);
});

test('clave revocada y t>revoked_at -> revoked-key', async () => {
    const g = await genKp();
    const ev = await msgEvent('a', AFTER_REV, g.privateKeyJwk, 1);
    const ledger = new Map([['a', keyState([entry(g.publicKeyJwk, T0, 'revoked', null, REV_AT)])]]);
    assert.deepStrictEqual(await verifyTemporalProvenance(ev, ledger), ['revoked-key']);
});

test('clave vieja firmada ANTES de rotacion -> []', async () => {
    const g = await genKp();
    const n = await genKp();
    const ev = await msgEvent('a', T0, g.privateKeyJwk, 1);
    const ledger = new Map([['a', keyState([
        entry(g.publicKeyJwk, T0, 'rotated', ROT_AT, null),
        entry(n.publicKeyJwk, ROT_AT, 'active', null, null)
    ])]]);
    assert.deepStrictEqual(await verifyTemporalProvenance(ev, ledger), []);
});

test('clave nueva firmada DESPUES de rotacion -> []', async () => {
    const g = await genKp();
    const n = await genKp();
    const ev = await msgEvent('a', AFTER_ROT, n.privateKeyJwk, 1);
    const ledger = new Map([['a', keyState([
        entry(g.publicKeyJwk, T0, 'rotated', ROT_AT, null),
        entry(n.publicKeyJwk, ROT_AT, 'active', null, null)
    ])]]);
    assert.deepStrictEqual(await verifyTemporalProvenance(ev, ledger), []);
});