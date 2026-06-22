// Property-tests congelados — contrato action-list-workflows.
// Oráculo independiente: escribe los JSON con fs directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { listWorkflows } = require('../../lib/actions');
const { RepoError } = require('../../lib/gitRepos');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'list-wf-'));
}

async function writeWf(base, repo, name, trigger) {
  const dir = path.join(base, repo);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, name + '.json'), JSON.stringify({ name, trigger, steps: [{ name: name, command: 'c' }] }));
}

test('repo sin dir devuelve []', async () => {
  const base = await tmpBase();
  try {
    const list = await listWorkflows('nope', base);
    assert.deepStrictEqual(list, []);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('devuelve workflows ordenados por nombre', async () => {
  const base = await tmpBase();
  try {
    await writeWf(base, 'r', 'b', 'push');
    await writeWf(base, 'r', 'a', 'manual');
    const list = await listWorkflows('r', base);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].name, 'a');
    assert.strictEqual(list[1].name, 'b');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('ignora archivos no-json', async () => {
  const base = await tmpBase();
  try {
    await writeWf(base, 'r', 'a', 'push');
    await fs.promises.writeFile(path.join(base, 'r', 'notjson.txt'), 'x');
    const list = await listWorkflows('r', base);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, 'a');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('ignora json corrupto', async () => {
  const base = await tmpBase();
  try {
    await writeWf(base, 'r', 'a', 'push');
    await fs.promises.writeFile(path.join(base, 'r', 'broken.json'), '{not json');
    const list = await listWorkflows('r', base);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, 'a');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('path traversal lanza invalid_name', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => listWorkflows('../bad', base), (e) => e instanceof RepoError && e.code === 'invalid_name');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});