// Property-tests congelados — contrato pr-validate-branches.
// Oráculo independiente: crea repo bare real con git + ramas (no importa internos del target).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { validateBranchesExist, PullError } = require('../../lib/pulls');

function gitLocal(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => err ? reject(err) : resolve(stdout));
  });
}

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-validate-branches-'));
}

// Crea un bare repo con ramas main y feat (feat con un commit extra sobre main).
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
  // HEAD por defecto puede ser master o main; renombramos a main y subimos.
  await gitLocal(['-C', clonePath, 'branch', '-M', 'main']);
  await gitLocal(['-C', clonePath, 'checkout', '-b', 'feat']);
  await fs.promises.writeFile(path.join(clonePath, 'f.txt'), 'cambio');
  await gitLocal(['-C', clonePath, 'add', '.']);
  await gitLocal(['-C', clonePath, 'commit', '-m', 'feat change']);
  await gitLocal(['-C', clonePath, 'push', 'origin', 'main']);
  await gitLocal(['-C', clonePath, 'push', 'origin', 'feat']);
  return barePath;
}

test('ambas ramas existen -> ok', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeRepoWithBranches(base);
    const r = await validateBranchesExist(barePath, 'feat', 'main');
    assert.strictEqual(r.head, 'feat');
    assert.strictEqual(r.base, 'main');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('head inexistente lanza branch_not_found', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeRepoWithBranches(base);
    await assert.rejects(() => validateBranchesExist(barePath, 'missing', 'main'), (e) => e instanceof PullError && e.code === 'branch_not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('base inexistente lanza branch_not_found', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeRepoWithBranches(base);
    await assert.rejects(() => validateBranchesExist(barePath, 'feat', 'missing'), (e) => e instanceof PullError && e.code === 'branch_not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('rama con .. lanza invalid_branch', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeRepoWithBranches(base);
    await assert.rejects(() => validateBranchesExist(barePath, 'a..b', 'main'), (e) => e instanceof PullError && e.code === 'invalid_branch');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});