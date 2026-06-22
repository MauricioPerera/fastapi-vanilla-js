// Property-tests congelados — contrato action-dispatch-workflow.
// Oráculo independiente: escribe el workflow con fs directo y lee el run persistido con fs directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { dispatchWorkflow, ActionError } = require('../../lib/actions');
const { RepoError } = require('../../lib/gitRepos');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'disp-wf-'));
}

async function writeScript(base, body) {
  const file = path.join(base, 's_' + Math.random().toString(36).slice(2) + '.js');
  await fs.promises.writeFile(file, body, 'utf8');
  return file;
}

async function seedWorkflow(base, repo, wfName, script) {
  const dir = path.join(base, 'wfs', repo);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, wfName + '.json'), JSON.stringify({ name: wfName, trigger: 'manual', steps: [{ command: 'node ' + script }] }));
}

test('dispatch de workflow existente ejecuta y persiste un run', async () => {
  const base = await tmpBase();
  try {
    const script = await writeScript(base, "process.stdout.write('ok')");
    await seedWorkflow(base, 'r', 'build', script);
    const ctx = { workflowsDir: path.join(base, 'wfs'), runsDir: path.join(base, 'runs'), cwd: base };
    const run = await dispatchWorkflow('r', 'build', 'manual', ctx);
    assert.strictEqual(run.status, 'success');
    assert.strictEqual(run.workflow, 'build');
    assert.strictEqual(run.event, 'manual');
    assert.strictEqual(run.steps.length, 1);
    assert.strictEqual(run.steps[0].stdout, 'ok');
    const onDisk = JSON.parse(await fs.promises.readFile(path.join(base, 'runs', 'r', run.id + '.json'), 'utf8'));
    assert.strictEqual(onDisk.id, run.id);
    assert.strictEqual(onDisk.status, 'success');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('workflow inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    const ctx = { workflowsDir: path.join(base, 'wfs'), runsDir: path.join(base, 'runs'), cwd: base };
    await assert.rejects(() => dispatchWorkflow('r', 'missing', 'manual', ctx), (e) => e instanceof ActionError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('repoName con path traversal lanza invalid_name', async () => {
  const base = await tmpBase();
  try {
    const ctx = { workflowsDir: path.join(base, 'wfs'), runsDir: path.join(base, 'runs'), cwd: base };
    await assert.rejects(() => dispatchWorkflow('../bad', 'w', 'manual', ctx), (e) => e instanceof RepoError && e.code === 'invalid_name');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('wfName con path traversal lanza invalid_name', async () => {
  const base = await tmpBase();
  try {
    const ctx = { workflowsDir: path.join(base, 'wfs'), runsDir: path.join(base, 'runs'), cwd: base };
    await assert.rejects(() => dispatchWorkflow('r', '../bad', 'manual', ctx), (e) => e instanceof RepoError && e.code === 'invalid_name');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});