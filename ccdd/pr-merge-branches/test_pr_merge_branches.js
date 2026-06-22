// Property-tests congelados — contrato pr-merge-branches.
// Oráculo independiente: repo bare real; verifica avance del ref y limpieza con git directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { mergeBranches, PullError } = require('../../lib/pulls');

function gitLocal(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout) => err ? reject(err) : resolve(stdout));
  });
}

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-merge-branches-'));
}

// Crea repo bare con main (1 commit) y feat (1 commit distinto sobre main) — merge limpio.
async function makeCleanRepo(base) {
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

// Crea repo bare con conflicto: main y feat modifican la misma línea de f.txt.
async function makeConflictRepo(base) {
  const barePath = path.join(base, 'repo.git');
  const clonePath = path.join(base, 'clone');
  await gitLocal(['init', '--bare', barePath]);
  await gitLocal(['clone', barePath, clonePath]);
  await gitLocal(['-C', clonePath, 'config', 'user.email', 'a@a.com']);
  await gitLocal(['-C', clonePath, 'config', 'user.name', 'Ana']);
  await fs.promises.writeFile(path.join(clonePath, 'f.txt'), 'base');
  await gitLocal(['-C', clonePath, 'add', '.']);
  await gitLocal(['-C', clonePath, 'commit', '-m', 'init']);
  await gitLocal(['-C', clonePath, 'branch', '-M', 'main']);
  // main modifica f.txt
  await fs.promises.writeFile(path.join(clonePath, 'f.txt'), 'main-version');
  await gitLocal(['-C', clonePath, 'add', '.']);
  await gitLocal(['-C', clonePath, 'commit', '-m', 'main change']);
  await gitLocal(['-C', clonePath, 'push', 'origin', 'main']);
  // feat parte de init y modifica la misma línea distinto
  await gitLocal(['-C', clonePath, 'checkout', '-b', 'feat', 'main~1']);
  await fs.promises.writeFile(path.join(clonePath, 'f.txt'), 'feat-version');
  await gitLocal(['-C', clonePath, 'add', '.']);
  await gitLocal(['-C', clonePath, 'commit', '-m', 'feat change']);
  await gitLocal(['-C', clonePath, 'push', 'origin', 'feat']);
  return barePath;
}

test('merge limpio -> SHA no vacio y refs/heads/main avanza', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeCleanRepo(base);
    const before = (await gitLocal(['rev-parse', 'refs/heads/main'], barePath)).trim();
    const { mergeCommitSha } = await mergeBranches(barePath, 'main', 'feat');
    assert.ok(mergeCommitSha && mergeCommitSha.length > 0, 'SHA no vacio');
    const after = (await gitLocal(['rev-parse', 'refs/heads/main'], barePath)).trim();
    assert.notStrictEqual(after, before, 'main avanzo');
    assert.strictEqual(after, mergeCommitSha, 'main apunta al SHA devuelto');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('Already up to date -> SHA actual de base', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeCleanRepo(base);
    const before = (await gitLocal(['rev-parse', 'refs/heads/main'], barePath)).trim();
    const { mergeCommitSha } = await mergeBranches(barePath, 'main', 'main');
    assert.strictEqual(mergeCommitSha, before, 'SHA = base actual');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('conflicto -> merge_conflict y base no avanza; no queda worktree', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeConflictRepo(base);
    const before = (await gitLocal(['rev-parse', 'refs/heads/main'], barePath)).trim();
    await assert.rejects(() => mergeBranches(barePath, 'main', 'feat'), (e) => e instanceof PullError && e.code === 'merge_conflict');
    const after = (await gitLocal(['rev-parse', 'refs/heads/main'], barePath)).trim();
    assert.strictEqual(after, before, 'base no avanzo tras conflicto');
    const wtList = await gitLocal(['worktree', 'list'], barePath);
    assert.ok(!wtList.includes('prmerge-'), 'no queda worktree temporal colgado');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('rama con .. lanza invalid_branch', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeCleanRepo(base);
    await assert.rejects(() => mergeBranches(barePath, 'a..b', 'feat'), (e) => e instanceof PullError && e.code === 'invalid_branch');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});