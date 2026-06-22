// Property-tests congelados — contrato pr-create.
// Oráculo independiente: fs/os directos + helper de store propio (no importa internos del target).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createPull, PullError } = require('../../lib/pulls');
const { RepoError } = require('../../lib/gitRepos');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-create-'));
}

test('crea primer PR number 1 open con comments vacios y mergeCommitSha null', async () => {
  const base = await tmpBase();
  try {
    const pull = await createPull('r', base, { title: 'T', body: 'x', head: 'feat', base: 'main' });
    assert.strictEqual(pull.number, 1);
    assert.strictEqual(pull.title, 'T');
    assert.strictEqual(pull.body, 'x');
    assert.strictEqual(pull.head, 'feat');
    assert.strictEqual(pull.base, 'main');
    assert.strictEqual(pull.state, 'open');
    assert.strictEqual(pull.mergeCommitSha, null);
    assert.strictEqual(pull.mergedAt, null);
    assert.deepStrictEqual(pull.comments, []);
    assert.strictEqual(pull.createdAt, pull.updatedAt);
    const store = JSON.parse(await fs.promises.readFile(path.join(base, 'r.json'), 'utf8'));
    assert.strictEqual(store.nextNumber, 2);
    assert.strictEqual(store.pulls.length, 1);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('segunda llamada autoincrementa numero', async () => {
  const base = await tmpBase();
  try {
    await createPull('r', base, { title: 'uno', head: 'a', base: 'main' });
    const pull = await createPull('r', base, { title: 'dos', head: 'b', base: 'main' });
    assert.strictEqual(pull.number, 2);
    const store = JSON.parse(await fs.promises.readFile(path.join(base, 'r.json'), 'utf8'));
    assert.strictEqual(store.nextNumber, 3);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('title vacio lanza invalid_body', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => createPull('r', base, { head: 'a', base: 'main' }), (e) => e instanceof PullError && e.code === 'invalid_body');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('base ausente lanza invalid_body', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => createPull('r', base, { title: 'T', head: 'a' }), (e) => e instanceof PullError && e.code === 'invalid_body');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('rama con .. lanza invalid_branch', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => createPull('r', base, { title: 'T', head: 'a..b', base: 'main' }), (e) => e instanceof PullError && e.code === 'invalid_branch');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('nombre con path traversal lanza invalid_name', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => createPull('../bad', base, { title: 'T', head: 'a', base: 'main' }), (e) => e instanceof RepoError && e.code === 'invalid_name');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});