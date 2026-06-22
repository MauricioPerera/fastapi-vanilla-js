// Property-tests congelados — contrato repo-info.
// Oráculo independiente: usa child_process directo para sembrar estado git (no importa internos).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { createBareRepo, getRepoInfo, RepoError } = require('../../lib/gitRepos');

function gitLocal(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, (err, stdout, stderr) => err ? reject(err) : resolve(stdout));
  });
}

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'repo-info-'));
}

test('repo vacío: branches [], lastCommit null', async () => {
  const base = await tmpBase();
  try {
    await createBareRepo('empty', base);
    const info = await getRepoInfo('empty', base);
    assert.strictEqual(info.name, 'empty');
    assert.deepStrictEqual(info.branches, []);
    assert.strictEqual(info.lastCommit, null);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('repo inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => getRepoInfo('nope', base), (e) => e instanceof RepoError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('repo con commit pusheado: rama main y lastCommit', async () => {
  const base = await tmpBase();
  try {
    await createBareRepo('work', base);
    const barePath = path.join(base, 'work.git');
    const clonePath = path.join(base, 'work-clone');
    await gitLocal(['clone', barePath, clonePath]);
    await gitLocal(['-C', clonePath, 'config', 'user.email', 'a@a.com']);
    await gitLocal(['-C', clonePath, 'config', 'user.name', 'Ana']);
    await fs.promises.writeFile(path.join(clonePath, 'f.txt'), 'hola');
    await gitLocal(['-C', clonePath, 'add', '.']);
    await gitLocal(['-C', clonePath, 'commit', '-m', 'fix bug']);
    await gitLocal(['-C', clonePath, 'push', 'origin', 'HEAD']);
    const branch = (await gitLocal(['-C', clonePath, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const info = await getRepoInfo('work', base);
    assert.ok(info.branches.includes(branch), `branches debe incluir ${branch}`);
    assert.ok(info.lastCommit, 'lastCommit no debe ser null');
    assert.strictEqual(info.lastCommit.author, 'Ana');
    assert.strictEqual(info.lastCommit.message, 'fix bug');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});