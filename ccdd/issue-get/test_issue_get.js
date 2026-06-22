// Property-tests congelados — contrato issue-get.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createIssue, getIssue, IssueError } = require('../../lib/issues');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'issue-get-'));
}

test('issue existente devuelto con sus campos', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T', body: 'B', labels: ['x'] });
    const issue = await getIssue('r', base, 1);
    assert.strictEqual(issue.number, 1);
    assert.strictEqual(issue.title, 'T');
    assert.strictEqual(issue.body, 'B');
    assert.deepStrictEqual(issue.labels, ['x']);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('numero inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    await assert.rejects(() => getIssue('r', base, 99), (e) => e instanceof IssueError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('repo sin store lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => getIssue('r', base, 1), (e) => e instanceof IssueError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});