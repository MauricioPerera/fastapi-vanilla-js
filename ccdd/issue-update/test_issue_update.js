// Property-tests congelados — contrato issue-update.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createIssue, updateIssue, getIssue, IssueError } = require('../../lib/issues');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'issue-update-'));
}

test('actualizar solo titulo deja body y labels intactos', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'Viejo', body: 'B', labels: ['x'] });
    const before = await getIssue('r', base, 1);
    const updated = await updateIssue('r', base, 1, { title: 'Nuevo' });
    assert.strictEqual(updated.title, 'Nuevo');
    assert.strictEqual(updated.body, 'B');
    assert.deepStrictEqual(updated.labels, ['x']);
    assert.strictEqual(updated.number, 1);
    assert.ok(updated.updatedAt >= before.updatedAt);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('actualizar labels reemplaza el array', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T', labels: ['x'] });
    const updated = await updateIssue('r', base, 1, { labels: ['bug', 'urgent'] });
    assert.deepStrictEqual(updated.labels, ['bug', 'urgent']);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('issue inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    await assert.rejects(() => updateIssue('r', base, 99, { title: 'x' }), (e) => e instanceof IssueError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('title vacio en patch lanza invalid_body', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    await assert.rejects(() => updateIssue('r', base, 1, { title: '' }), (e) => e instanceof IssueError && e.code === 'invalid_body');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});