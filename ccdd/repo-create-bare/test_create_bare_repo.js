// Property-tests congelados — contrato repo-create-bare.
// Oráculo independiente: usa fs/os directos y un helper git local (no importa internos del target).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { createBareRepo, RepoError } = require('../../lib/gitRepos');

function gitLocal(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err) => err ? reject(err) : resolve());
  });
}

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'repo-create-'));
}

test('crea bare repo con HEAD', async () => {
  const base = await tmpBase();
  try {
    const r = await createBareRepo('mi-repo', base);
    assert.strictEqual(r.name, 'mi-repo');
    assert.ok(r.path.endsWith('mi-repo.git'));
    assert.ok(fs.existsSync(path.join(r.path, 'HEAD')));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('rechaza nombre con path traversal', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => createBareRepo('../bad', base), (e) => e instanceof RepoError && e.code === 'invalid_name');
    assert.ok(!fs.existsSync(path.join(base, 'bad.git')));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('rechaza duplicado', async () => {
  const base = await tmpBase();
  try {
    await createBareRepo('dup', base);
    await assert.rejects(() => createBareRepo('dup', base), (e) => e instanceof RepoError && e.code === 'exists');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('crea reposDir si no existe', async () => {
  const base = await tmpBase();
  const nested = path.join(base, 'nested', 'deeper');
  try {
    const r = await createBareRepo('x', nested);
    assert.ok(fs.existsSync(path.join(r.path, 'HEAD')));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});