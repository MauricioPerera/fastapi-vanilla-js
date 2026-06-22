// Property-tests congelados — contrato pr-commits.
// Oráculo independiente: repo bare real con ramas; cuenta commits con git directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { getPrCommits, PullError } = require('../../lib/pulls');

function gitLocal(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout) => err ? reject(err) : resolve(stdout));
  });
}

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-commits-'));
}

async function makeRepoWithBranches(base) {
  const barePath = path.join(base, 'repo.git');
  const clonePath = path.join(base, 'clone');
  await gitLocal(['init', '--bare', barePath]);
  await gitLocal(['clone', barePath, clonePath]);
  await gitLocal(['-C', clonePath, 'config', 'user.email', 'a@a.com']);
  await gitLocal(['-C', clonePath, 'config', 'user.name', 'Ana']);
  await fs.promises.writeFile(path.join(clonePath, 'f.txt'), 'hola');
  await gitLocal(['-C', clonePath, 'add', '.']);
  await gitLocal(['-C', clonePath, 'commit', '-m', 'init']);
  await gitLocal(['-C', clonePath, 'branch', '-M', 'main']);
  await gitLocal(['-C', clonePath, 'checkout', '-b', 'feat']);
  await fs.promises.writeFile(path.join(clonePath, 'g.txt'), 'nuevo');
  await gitLocal(['-C', clonePath, 'add', '.']);
  await gitLocal(['-C', clonePath, 'commit', '-m', 'feat change']);
  await gitLocal(['-C', clonePath, 'push', 'origin', 'main']);
  await gitLocal(['-C', clonePath, 'push', 'origin', 'feat']);
  return barePath;
}

test('feat con 1 commit sobre main -> 1 commit', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeRepoWithBranches(base);
    const commits = await getPrCommits(barePath, 'feat', 'main');
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].author, 'Ana');
    assert.strictEqual(commits[0].message, 'feat change');
    assert.ok(commits[0].hash);
    assert.ok(commits[0].date);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('head === base -> []', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeRepoWithBranches(base);
    const commits = await getPrCommits(barePath, 'main', 'main');
    assert.deepStrictEqual(commits, []);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('rama con .. lanza invalid_branch', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeRepoWithBranches(base);
    await assert.rejects(() => getPrCommits(barePath, 'a..b', 'main'), (e) => e instanceof PullError && e.code === 'invalid_branch');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});