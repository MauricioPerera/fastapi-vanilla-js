// Property-tests congelados — contrato action-list-runs.
// Oráculo independiente: escribe runs con fs directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { listRuns } = require('../../lib/actions');
const { RepoError } = require('../../lib/gitRepos');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'list-runs-'));
}

async function writeRun(base, repo, id, status) {
  const dir = path.join(base, repo);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, id + '.json'), JSON.stringify({ id, status, steps: [] }));
}

test('repo sin dir devuelve []', async () => {
  const base = await tmpBase();
  try {
    const list = await listRuns('nope', base);
    assert.deepStrictEqual(list, []);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('devuelve runs ordenados por id', async () => {
  const base = await tmpBase();
  try {
    await writeRun(base, 'r', 'zzz-1', 'success');
    await writeRun(base, 'r', 'aaa-2', 'failure');
    const list = await listRuns('r', base);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].id, 'aaa-2');
    assert.strictEqual(list[1].id, 'zzz-1');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('ignora archivos no-json', async () => {
  const base = await tmpBase();
  try {
    await writeRun(base, 'r', 'run1', 'success');
    await fs.promises.writeFile(path.join(base, 'r', 'notes.txt'), 'x');
    const list = await listRuns('r', base);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'run1');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('ignora json corrupto', async () => {
  const base = await tmpBase();
  try {
    await writeRun(base, 'r', 'run1', 'success');
    await fs.promises.writeFile(path.join(base, 'r', 'broken.json'), '{nope');
    const list = await listRuns('r', base);
    assert.strictEqual(list.length, 1);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('path traversal lanza invalid_name', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => listRuns('../bad', base), (e) => e instanceof RepoError && e.code === 'invalid_name');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});