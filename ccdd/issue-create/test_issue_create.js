// Property-tests congelados — contrato issue-create.
// Oráculo independiente: usa fs/os directos y un helper de store propio (no importa internos del target).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createIssue, IssueError } = require('../../lib/issues');
const { RepoError } = require('../../lib/gitRepos');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'issue-create-'));
}

test('crea primer issue number 1 open con comments vacios y persiste', async () => {
  const base = await tmpBase();
  try {
    const issue = await createIssue('r', base, { title: 'Bug', body: 'x', labels: ['bug'] });
    assert.strictEqual(issue.number, 1);
    assert.strictEqual(issue.title, 'Bug');
    assert.strictEqual(issue.body, 'x');
    assert.deepStrictEqual(issue.labels, ['bug']);
    assert.strictEqual(issue.state, 'open');
    assert.deepStrictEqual(issue.comments, []);
    assert.strictEqual(issue.createdAt, issue.updatedAt);
    const store = JSON.parse(await fs.promises.readFile(path.join(base, 'r.json'), 'utf8'));
    assert.strictEqual(store.nextNumber, 2);
    assert.strictEqual(store.issues.length, 1);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('segunda llamada autoincrementa numero', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'uno' });
    const issue = await createIssue('r', base, { title: 'dos' });
    assert.strictEqual(issue.number, 2);
    const store = JSON.parse(await fs.promises.readFile(path.join(base, 'r.json'), 'utf8'));
    assert.strictEqual(store.nextNumber, 3);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('title vacio lanza invalid_body', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => createIssue('r', base, { body: 'x' }), (e) => e instanceof IssueError && e.code === 'invalid_body');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('labels no-array lanza invalid_body', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => createIssue('r', base, { title: 'x', labels: 'bug' }), (e) => e instanceof IssueError && e.code === 'invalid_body');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('nombre con path traversal lanza invalid_name', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => createIssue('../bad', base, { title: 'x' }), (e) => e instanceof RepoError && e.code === 'invalid_name');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});