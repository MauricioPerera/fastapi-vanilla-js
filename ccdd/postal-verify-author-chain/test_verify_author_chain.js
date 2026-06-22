'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { verifyAuthorChain, eventHash } = require('../../lib/postal');

function ev(seq, prev, extra) { return Object.assign({ from: 'a', seq, prev, kind: 'agent.message', body: {}, created_at: '2026-01-01T00:00:00.000Z', id: 'id' + seq, to: [], v: 1, sig: null }, extra || {}); }

test('cadena valida -> sin fallos', async () => {
  const e0 = ev(0, null);
  const e1 = ev(1, await eventHash(e0));
  const f = await verifyAuthorChain('a', [e1, e0]);
  assert.strictEqual(f.length, 0);
});
test('gap detectado', async () => {
  const e0 = ev(0, null);
  const e2 = ev(2, null);
  const f = await verifyAuthorChain('a', [e0, e2]);
  assert.ok(f.length >= 1);
  assert.ok(f[0].reasons.some((r) => r.indexOf('chain-gap') === 0));
});
test('prev mismatch detectado', async () => {
  const e0 = ev(0, null);
  const e1 = ev(1, 'wronghash');
  const f = await verifyAuthorChain('a', [e0, e1]);
  assert.ok(f.some((x) => x.reasons.includes('chain-prev-mismatch')));
});
test('no muta la lista de entrada', async () => {
  const e0 = ev(0, null);
  const list = [e0];
  await verifyAuthorChain('a', list);
  assert.strictEqual(list[0], e0);
});

// --- Regresion chain-broken (lo que el e2e no veia) ---
// Oraculo independiente: construye la cadena real con eventHash y luego la rompe
// (borrando o editando un evento medio); verifica que el corte se propaga a TODOS
// los posteriores del autor, no solo al inmediato.

async function chain4() {
  const e0 = ev(0, null);
  const e1 = ev(1, await eventHash(e0));
  const e2 = ev(2, await eventHash(e1));
  const e3 = ev(3, await eventHash(e2));
  return [e0, e1, e2, e3];
}

test('regresion: borrar el evento medio -> sucesor Y posteriores se rechazan (chain-broken)', async () => {
  const [e0, , e2, e3] = await chain4();
  // se borra e1: e2 queda con prev = hash(e1) que ya no esta; seq salteado 0,_,2,3
  const f = await verifyAuthorChain('a', [e0, e2, e3]);
  // e2: chain-gap + chain-prev-mismatch (el evento que rompe conserva sus reasons)
  const f2 = f.find((x) => x.seq === 2);
  assert.ok(f2, 'seq 2 reportado');
  assert.ok(f2.reasons.some((r) => r.indexOf('chain-gap') === 0));
  assert.ok(f2.reasons.includes('chain-prev-mismatch'));
  // e3: chain-broken (NO valida aunque seq/prev coincidan con el real)
  const f3 = f.find((x) => x.seq === 3);
  assert.ok(f3, 'seq 3 reportado');
  assert.deepStrictEqual(f3.reasons, ['chain-broken']);
  // no queda ningun evento de seq>2 sin reportar
  assert.ok(f.every((x) => x.seq >= 2), 'todos los posteriores al corte reportados');
});

test('regresion: editar un evento intermedio -> posteriores se rechazan (chain-broken)', async () => {
  const [e0, e1, e2, e3] = await chain4();
  // se edita e1: su contenido cambia, su hash ya no calza con e2.prev
  const e1bad = ev(1, await eventHash(e0), { body: { text: 'editado' } });
  const f = await verifyAuthorChain('a', [e0, e1bad, e2, e3]);
  // e1: seq=1=expected ok, pero prev=hash(e0) ok -> NO falla por si mismo (e1bad sigue
  // enlazando bien con e0). El corte aparece en e2 (prev=hash(e1 original) != hash(e1bad))
  const f2 = f.find((x) => x.seq === 2);
  assert.ok(f2, 'seq 2 reportado (cadena rota por edicion del previo)');
  assert.ok(f2.reasons.includes('chain-prev-mismatch'));
  // e3: chain-broken
  const f3 = f.find((x) => x.seq === 3);
  assert.ok(f3, 'seq 3 reportado');
  assert.deepStrictEqual(f3.reasons, ['chain-broken']);
});

test('regresion: cadena intacta sigue sin reportar chain-broken', async () => {
  const [e0, e1, e2, e3] = await chain4();
  const f = await verifyAuthorChain('a', [e0, e1, e2, e3]);
  assert.strictEqual(f.length, 0);
  // desordenada tambien valida
  const f2 = await verifyAuthorChain('a', [e3, e1, e0, e2]);
  assert.strictEqual(f2.length, 0);
});
