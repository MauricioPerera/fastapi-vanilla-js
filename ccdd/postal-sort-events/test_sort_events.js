'use strict';
// Oraculo independiente para sortEvents: no importa nada del target; define el
// orden esperado con un modelo propio (sort por [created_at, seq]) y compara.
const test = require('node:test');
const assert = require('node:assert');
const { sortEvents } = require('../../lib/postal');

function e(created_at, seq) { return { created_at, seq, id: 'id' + seq, kind: 'x', from: 'a', to: [], v: 1, body: {}, prev: null, sig: null }; }

// Modelo independiente: copia + sort por created_at y luego seq.
function expectedSorted(events) {
    return events.slice().sort((a, b) => {
        if (a.created_at < b.created_at) return -1;
        if (a.created_at > b.created_at) return 1;
        return a.seq - b.seq;
    });
}

test('vacio -> vacio', () => {
    assert.deepStrictEqual(sortEvents([]), []);
});

test('ordena por created_at', () => {
    const a = e('2026-01-02T00:00:00.000Z', 1);
    const b = e('2026-01-01T00:00:00.000Z', 0);
    const out = sortEvents([a, b]);
    assert.deepStrictEqual(out.map((x) => x.seq), [0, 1]);
});

test('regresion: mismo created_at distinto seq -> orden determinista por seq', () => {
    const T = '2026-06-21T12:00:00.000Z';
    const evs = [e(T, 2), e(T, 0), e(T, 1)];
    const out = sortEvents(evs);
    // desempate por seq: 0,1,2 sin importar el orden de entrada
    assert.deepStrictEqual(out.map((x) => x.seq), [0, 1, 2]);
    assert.deepStrictEqual(out, expectedSorted(evs));
});

test('regresion: determinismo — dos llamadas mismas entradas -> mismo orden', () => {
    const T = '2026-06-21T12:00:00.000Z';
    const evs = [e(T, 5), e(T, 1), e(T, 3), e(T, 1)];
    const o1 = sortEvents(evs).map((x) => x.seq);
    const o2 = sortEvents(evs).map((x) => x.seq);
    assert.deepStrictEqual(o1, o2);
});

test('no muta el array de entrada', () => {
    const a = e('2026-01-02T00:00:00.000Z', 1);
    const b = e('2026-01-01T00:00:00.000Z', 0);
    const input = [a, b];
    sortEvents(input);
    assert.deepStrictEqual(input, [a, b]);
});