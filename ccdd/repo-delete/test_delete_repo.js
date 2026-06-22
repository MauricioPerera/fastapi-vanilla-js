// Property-tests congelados — contrato repo-delete.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createBareRepo, deleteRepo, RepoError } = require('../../lib/gitRepos');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'repo-delete-'));
}

test('borra un repo existente', async () => {
  const base = await tmpBase();
  try {
    await createBareRepo('gone', base);
    const r = await deleteRepo('gone', base);
    assert.strictEqual(r.name, 'gone');
    assert.strictEqual(r.deleted, true);
    assert.ok(!fs.existsSync(path.join(base, 'gone.git')));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('lanza not_found si no existe', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => deleteRepo('nope', base), (e) => e instanceof RepoError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('lanza invalid_name para path traversal', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => deleteRepo('../bad', base), (e) => e instanceof RepoError && e.code === 'invalid_name');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});