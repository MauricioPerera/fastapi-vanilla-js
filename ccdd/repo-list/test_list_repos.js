// Property-tests congelados — contrato repo-list.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createBareRepo, listRepos } = require('../../lib/gitRepos');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'repo-list-'));
}

test('dir inexistente -> []', async () => {
  const base = path.join(os.tmpdir(), 'no-existe-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  assert.deepStrictEqual(await listRepos(base), []);
});

test('lista solo .git bare ordenados por nombre', async () => {
  const base = await tmpBase();
  try {
    await createBareRepo('beta', base);
    await createBareRepo('alpha', base);
    const list = await listRepos(base);
    assert.deepStrictEqual(list.map((r) => r.name), ['alpha', 'beta']);
    assert.ok(list[0].path.endsWith('alpha.git'));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('excluye .git sin HEAD', async () => {
  const base = await tmpBase();
  try {
    await createBareRepo('real', base);
    await fs.promises.mkdir(path.join(base, 'fake.git'), { recursive: true }); // sin HEAD
    const list = await listRepos(base);
    assert.deepStrictEqual(list.map((r) => r.name), ['real']);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('dir vacío -> []', async () => {
  const base = await tmpBase();
  try {
    assert.deepStrictEqual(await listRepos(base), []);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});