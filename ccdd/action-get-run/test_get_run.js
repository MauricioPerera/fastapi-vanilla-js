// Property-tests congelados — contrato action-get-run.
// Oráculo independiente: escribe el run con fs directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getRun, ActionError } = require('../../lib/actions');
const { RepoError } = require('../../lib/gitRepos');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'get-run-'));
}

async function writeRun(base, repo, id) {
  const dir = path.join(base, repo);
  await fs.promises.mkdir(dir, { recursive: true });
  const run = { id, workflow: 'w', event: 'manual', status: 'success', steps: [{ name: 'c', command: 'c', status: 'success', stdout: 'out', stderr: '', exitCode: 0 }] };
  await fs.promises.writeFile(path.join(dir, id + '.json'), JSON.stringify(run));
  return run;
}

test('run existente se devuelve', async () => {
  const base = await tmpBase();
  try {
    const run = await writeRun(base, 'r', 'run-1');
    const got = await getRun('r', base, 'run-1');
    assert.strictEqual(got.id, 'run-1');
    assert.strictEqual(got.status, 'success');
    assert.deepStrictEqual(got.steps, run.steps);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('run inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => getRun('r', base, 'missing'), (e) => e instanceof ActionError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('runId con path traversal lanza invalid_id', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => getRun('r', base, '../x'), (e) => e instanceof ActionError && e.code === 'invalid_id');
    await assert.rejects(() => getRun('r', base, 'a/b'), (e) => e instanceof ActionError && e.code === 'invalid_id');
    assert.ok(!fs.existsSync(path.join(base, 'x.json')));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('runId vacio lanza invalid_id', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => getRun('r', base, ''), (e) => e instanceof ActionError && e.code === 'invalid_id');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('repoName con path traversal lanza invalid_name', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => getRun('../bad', base, 'run-1'), (e) => e instanceof RepoError && e.code === 'invalid_name');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});