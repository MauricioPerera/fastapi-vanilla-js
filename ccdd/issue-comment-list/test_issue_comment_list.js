// Property-tests congelados — contrato issue-comment-list.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createIssue, addComment, listComments, IssueError } = require('../../lib/issues');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'issue-comment-list-'));
}

test('issue con comentarios lista en orden', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    await addComment('r', base, 1, { author: 'a', body: 'primero' });
    await addComment('r', base, 1, { author: 'b', body: 'segundo' });
    const comments = await listComments('r', base, 1);
    assert.strictEqual(comments.length, 2);
    assert.strictEqual(comments[0].body, 'primero');
    assert.strictEqual(comments[1].body, 'segundo');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('issue sin comentarios devuelve []', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    const comments = await listComments('r', base, 1);
    assert.deepStrictEqual(comments, []);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('issue inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    await assert.rejects(() => listComments('r', base, 99), (e) => e instanceof IssueError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});