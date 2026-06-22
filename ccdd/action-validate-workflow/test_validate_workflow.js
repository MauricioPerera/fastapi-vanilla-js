// Property-tests congelados — contrato action-validate-workflow.
// Oráculo independiente: aplica las reglas de validación directamente.
const test = require('node:test');
const assert = require('node:assert');
const { validateWorkflow, ActionError, VALID_TRIGGERS } = require('../../lib/actions');

test('workflow valido se normaliza con steps string a {name,command}', () => {
  const wf = validateWorkflow({ name: 'build', trigger: 'push', steps: ['echo hi'] });
  assert.strictEqual(wf.name, 'build');
  assert.strictEqual(wf.trigger, 'push');
  assert.strictEqual(wf.steps.length, 1);
  assert.deepStrictEqual(wf.steps[0], { name: 'echo hi', command: 'echo hi' });
});

test('step objeto sin name usa command como nombre', () => {
  const wf = validateWorkflow({ name: 'w', trigger: 'manual', steps: [{ command: 'do-x', name: 'step1' }] });
  assert.deepStrictEqual(wf.steps[0], { name: 'step1', command: 'do-x' });
  const wf2 = validateWorkflow({ name: 'w', trigger: 'manual', steps: [{ command: 'do-y' }] });
  assert.strictEqual(wf2.steps[0].name, 'do-y');
});

test('name vacio lanza invalid_workflow', () => {
  assert.throws(() => validateWorkflow({ trigger: 'manual', steps: ['c'] }), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
  assert.throws(() => validateWorkflow({ name: '  ', trigger: 'manual', steps: ['c'] }), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
});

test('trigger invalido lanza invalid_workflow', () => {
  assert.throws(() => validateWorkflow({ name: 'w', trigger: 'bad', steps: ['c'] }), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
  assert.throws(() => validateWorkflow({ name: 'w', trigger: undefined, steps: ['c'] }), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
});

test('steps vacio o no-array lanza invalid_workflow', () => {
  assert.throws(() => validateWorkflow({ name: 'w', trigger: 'manual', steps: [] }), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
  assert.throws(() => validateWorkflow({ name: 'w', trigger: 'manual', steps: 'c' }), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
});

test('step con command no-string lanza invalid_workflow', () => {
  assert.throws(() => validateWorkflow({ name: 'w', trigger: 'manual', steps: [{ command: 5 }] }), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
  assert.throws(() => validateWorkflow({ name: 'w', trigger: 'manual', steps: [42] }), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
});

test('raw no-objeto lanza invalid_workflow', () => {
  assert.throws(() => validateWorkflow(null), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
  assert.throws(() => validateWorkflow('x'), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
});

test('todos los triggers validos son aceptados', () => {
  for (const t of VALID_TRIGGERS) {
    const wf = validateWorkflow({ name: 'w', trigger: t, steps: ['c'] });
    assert.strictEqual(wf.trigger, t);
  }
});