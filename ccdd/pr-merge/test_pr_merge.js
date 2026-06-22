// Property-tests congelados — contrato pr-merge.
// Oráculo independiente: repo bare real + store escrito con fs directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { mergePull, PullError } = require('../../lib/pulls');

function gitLocal(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout) => err ? reject(err) : resolve(stdout));
  });
}

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-merge-'));
}

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
  await fs.promises.writeFile(path.join(clonePath, 'f.txt'), 'main-version');
  await gitLocal(['-C', clonePath, 'add', '.']);
  await gitLocal(['-C', clonePath, 'commit', '-m', 'main change']);
  await gitLocal(['-C', clonePath, 'push', 'origin', 'main']);
  await gitLocal(['-C', clonePath, 'branch', '-f', 'feat', 'main~1']);
  await gitLocal(['-C', clonePath, 'checkout', 'feat']);
  await fs.promises.writeFile(path.join(clonePath, 'f.txt'), 'feat-version');
  await gitLocal(['-C', clonePath, 'add', '.']);
  await gitLocal(['-C', clonePath, 'commit', '-m', 'feat change']);
  await gitLocal(['-C', clonePath, 'push', 'origin', 'feat']);
  return barePath;
}

async function seedStore(base, pulls) {
  const store = { repo: 'r', nextNumber: pulls.length + 1, pulls };
  await fs.promises.writeFile(path.join(base, 'r.json'), JSON.stringify(store, null, 2), 'utf8');
}

test('merge limpio -> state merged, sha no vacio, base avanza', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeCleanRepo(base);
    await seedStore(base, [{ number: 1, title: 'T', head: 'feat', base: 'main', state: 'open', mergeCommitSha: null, mergedAt: null, createdAt: 't0', updatedAt: 't0', comments: [] }]);
    const before = (await gitLocal(['rev-parse', 'refs/heads/main'], barePath)).trim();
    const pull = await mergePull('r', base, barePath, 1);
    assert.strictEqual(pull.state, 'merged');
    assert.ok(pull.mergeCommitSha && pull.mergeCommitSha.length > 0, 'sha no vacio');
    assert.ok(pull.mergedAt, 'mergedAt seteado');
    const after = (await gitLocal(['rev-parse', 'refs/heads/main'], barePath)).trim();
    assert.notStrictEqual(after, before, 'base avanzo');
    const store = JSON.parse(await fs.promises.readFile(path.join(base, 'r.json'), 'utf8'));
    assert.strictEqual(store.pulls[0].state, 'merged');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('PR closed -> invalid_state', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeCleanRepo(base);
    await seedStore(base, [{ number: 1, title: 'T', head: 'feat', base: 'main', state: 'closed', mergeCommitSha: null, mergedAt: null, comments: [] }]);
    await assert.rejects(() => mergePull('r', base, barePath, 1), (e) => e instanceof PullError && e.code === 'invalid_state');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('PR ya merged -> invalid_state', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeCleanRepo(base);
    await seedStore(base, [{ number: 1, title: 'T', head: 'feat', base: 'main', state: 'merged', mergeCommitSha: 'abc', mergedAt: 't1', comments: [] }]);
    await assert.rejects(() => mergePull('r', base, barePath, 1), (e) => e instanceof PullError && e.code === 'invalid_state');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('conflicto -> merge_conflict y PR sigue open', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeConflictRepo(base);
    await seedStore(base, [{ number: 1, title: 'T', head: 'feat', base: 'main', state: 'open', mergeCommitSha: null, mergedAt: null, comments: [] }]);
    await assert.rejects(() => mergePull('r', base, barePath, 1), (e) => e instanceof PullError && e.code === 'merge_conflict');
    const store = JSON.parse(await fs.promises.readFile(path.join(base, 'r.json'), 'utf8'));
    assert.strictEqual(store.pulls[0].state, 'open', 'sigue open tras conflicto');
    assert.strictEqual(store.pulls[0].mergeCommitSha, null);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('PR inexistente -> not_found', async () => {
  const base = await tmpBase();
  try {
    const barePath = await makeCleanRepo(base);
    await seedStore(base, [{ number: 1, title: 'T', head: 'feat', base: 'main', state: 'open', comments: [] }]);
    await assert.rejects(() => mergePull('r', base, barePath, 99), (e) => e instanceof PullError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});