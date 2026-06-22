// Property-tests congelados — contrato action-save-workflow.
// Oráculo independiente: lee el JSON del disco con fs directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { saveWorkflow, ActionError } = require('../../lib/actions');
const { RepoError } = require('../../lib/gitRepos');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'save-wf-'));
}

test('guarda workflow en <repo>/<name>.json con forma correcta y steps normalizados', async () => {
  const base = await tmpBase();
  try {
    const res = await saveWorkflow('r', base, { name: 'build', trigger: 'push', steps: ['echo hi'] });
    assert.strictEqual(res.repo, 'r');
    assert.strictEqual(res.name, 'build');
    assert.ok(res.path.endsWith(path.join('r', 'build.json')));
    const onDisk = JSON.parse(await fs.promises.readFile(res.path, 'utf8'));
    assert.strictEqual(onDisk.name, 'build');
    assert.strictEqual(onDisk.trigger, 'push');
    assert.deepStrictEqual(onDisk.steps, [{ name: 'echo hi', command: 'echo hi' }]);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('nombre de workflow con path traversal lanza invalid_name', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => saveWorkflow('r', base, { name: '../bad', trigger: 'manual', steps: ['c'] }), (e) => e instanceof RepoError && e.code === 'invalid_name');
    assert.ok(!fs.existsSync(path.join(base, 'r')));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('repo con path traversal lanza invalid_name', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => saveWorkflow('../bad', base, { name: 'w', trigger: 'manual', steps: ['c'] }), (e) => e instanceof RepoError && e.code === 'invalid_name');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('workflow invalido lanza invalid_workflow y no escribe', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => saveWorkflow('r', base, { name: 'w', trigger: 'bad', steps: ['c'] }), (e) => e instanceof ActionError && e.code === 'invalid_workflow');
    assert.ok(!fs.existsSync(path.join(base, 'r')));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});