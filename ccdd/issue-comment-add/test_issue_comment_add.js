// Property-tests congelados — contrato issue-comment-add.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createIssue, addComment, getIssue, IssueError } = require('../../lib/issues');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'issue-comment-add-'));
}

test('comentario con autor se persiste en el issue', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    const comment = await addComment('r', base, 1, { author: 'alicia', body: 'hola' });
    assert.strictEqual(comment.author, 'alicia');
    assert.strictEqual(comment.body, 'hola');
    assert.ok(comment.createdAt);
    const issue = await getIssue('r', base, 1);
    assert.strictEqual(issue.comments.length, 1);
    assert.strictEqual(issue.comments[0].body, 'hola');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('author omitido queda anonymous', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    const comment = await addComment('r', base, 1, { body: 'x' });
    assert.strictEqual(comment.author, 'anonymous');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('body vacio lanza invalid_body', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    await assert.rejects(() => addComment('r', base, 1, { author: 'a' }), (e) => e instanceof IssueError && e.code === 'invalid_body');
    await assert.rejects(() => addComment('r', base, 1, { body: '' }), (e) => e instanceof IssueError && e.code === 'invalid_body');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('issue inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    await assert.rejects(() => addComment('r', base, 99, { body: 'x' }), (e) => e instanceof IssueError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});