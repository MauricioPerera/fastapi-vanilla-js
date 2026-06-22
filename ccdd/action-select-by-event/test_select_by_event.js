// Property-tests congelados — contrato action-select-by-event.
// Oráculo independiente: filter directo.
const test = require('node:test');
const assert = require('node:assert');
const { selectWorkflowsByEvent } = require('../../lib/actions');

test('filtra solo los de trigger coincidente conservando orden', () => {
  const wfs = [{ name: 'a', trigger: 'push' }, { name: 'b', trigger: 'issue_opened' }, { name: 'c', trigger: 'push' }];
  const out = selectWorkflowsByEvent(wfs, 'push');
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].name, 'a');
  assert.strictEqual(out[1].name, 'c');
});

test('entradas null se excluyen', () => {
  const out = selectWorkflowsByEvent([null, { trigger: 'push' }, undefined], 'push');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].trigger, 'push');
});

test('no es array devuelve []', () => {
  assert.deepStrictEqual(selectWorkflowsByEvent('x', 'push'), []);
  assert.deepStrictEqual(selectWorkflowsByEvent(null, 'push'), []);
});

test('event vacio o no-string devuelve []', () => {
  assert.deepStrictEqual(selectWorkflowsByEvent([{ trigger: 'push' }], ''), []);
  assert.deepStrictEqual(selectWorkflowsByEvent([{ trigger: 'push' }], null), []);
});

test('sin coincidencias devuelve []', () => {
  assert.deepStrictEqual(selectWorkflowsByEvent([{ trigger: 'push' }], 'manual'), []);
});