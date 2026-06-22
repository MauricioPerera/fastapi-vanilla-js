// Property-tests congelados — contrato action-run-workflow.
// Oráculo independiente: scripts node temporales, verifica forma del run y parada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runWorkflow, ActionError } = require('../../lib/actions');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'run-wf-'));
}

async function writeScript(base, body) {
  const file = path.join(base, 's_' + Math.random().toString(36).slice(2) + '.js');
  await fs.promises.writeFile(file, body, 'utf8');
  return file;
}

test('2 steps exitosos: success, 2 steps con timestamps', async () => {
  const base = await tmpBase();
  try {
    const s1 = await writeScript(base, "process.stdout.write('1')");
    const s2 = await writeScript(base, "process.stdout.write('2')");
    const run = await runWorkflow({ name: 'build', trigger: 'push', steps: [{ command: 'node ' + s1 }, { command: 'node ' + s2 }] }, 'push', base);
    assert.strictEqual(run.status, 'success');
    assert.strictEqual(run.workflow, 'build');
    assert.strictEqual(run.event, 'push');
    assert.strictEqual(run.steps.length, 2);
    assert.strictEqual(run.steps[0].stdout, '1');
    assert.strictEqual(run.steps[1].stdout, '2');
    assert.ok(run.startedAt && run.finishedAt);
    assert.ok(run.startedAt <= run.finishedAt);
    for (const s of run.steps) { assert.ok(s.startedAt && s.finishedAt); }
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('fallo en el 2.º step de 3: failure y el 3.º no se ejecuta', async () => {
  const base = await tmpBase();
  try {
    const s1 = await writeScript(base, "process.stdout.write('1')");
    const s2 = await writeScript(base, "process.exit(3)");
    const s3 = await writeScript(base, "process.stdout.write('3')");
    const run = await runWorkflow({ name: 'w', trigger: 'manual', steps: [{ command: 'node ' + s1 }, { command: 'node ' + s2 }, { command: 'node ' + s3 }] }, 'manual', base);
    assert.strictEqual(run.status, 'failure');
    assert.strictEqual(run.steps.length, 2);
    assert.strictEqual(run.steps[0].status, 'success');
    assert.strictEqual(run.steps[1].status, 'failure');
    assert.strictEqual(run.steps[1].exitCode, 3);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('run tiene id unico por llamada', async () => {
  const base = await tmpBase();
  try {
    const s = await writeScript(base, "process.stdout.write('x')");
    const wf = { name: 'w', trigger: 'manual', steps: [{ command: 'node ' + s }] };
    const r1 = await runWorkflow(wf, 'manual', base);
    const r2 = await runWorkflow(wf, 'manual', base);
    assert.ok(r1.id && typeof r1.id === 'string');
    assert.notStrictEqual(r1.id, r2.id);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('workflow invalido lanza invalid_workflow', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => runWorkflow({ name: 'w', trigger: 'bad', steps: ['c'] }, 'bad', base), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});