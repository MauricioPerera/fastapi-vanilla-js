// Property-tests congelados — contrato pr-diff-stat.
// Oráculo independiente: repo bare real; verifica con git directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { getPrDiffStat, PullError } = require('../../lib/pulls');

function gitLocal(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout) => err ? reject(err) : resolve(stdout));
  });
}

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-diff-stat-'));
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
  await fs.promises.writeFile(path.join(clonePath, 'g.txt'), 'nuevo archivo');
  await gitLocal(['-C', clonePath, 'add', '.']);
  await gitLocal(['-C', clonePath, 'commit', '-m', 'feat change']);
  await gitLocal(['-C', clonePath, 'push', 'origin', 'main']);
  await gitLocal(['-C', clonePath, 'push', 'origin', 'feat']);
  return barePath;
}

test('feat añade archivo -> filesChanged>=1 y additions>0', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeRepoWithBranches(base);
    const stat = await getPrDiffStat(barePath, 'feat', 'main');
    assert.ok(stat.filesChanged >= 1, 'filesChanged>=1');
    assert.ok(stat.totalAdditions > 0, 'additions>0');
    assert.ok(stat.files.some((f) => f.file === 'g.txt'), 'incluye g.txt');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('head === base -> resumen cero', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeRepoWithBranches(base);
    const stat = await getPrDiffStat(barePath, 'main', 'main');
    assert.deepStrictEqual(stat, { files: [], totalAdditions: 0, totalDeletions: 0, filesChanged: 0 });
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('rama con .. lanza invalid_branch', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeRepoWithBranches(base);
    await assert.rejects(() => getPrDiffStat(barePath, 'a..b', 'main'), (e) => e instanceof PullError && e.code === 'invalid_branch');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});