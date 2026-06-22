// Property-tests congelados — contrato issue-state.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createIssue, setIssueState, IssueError } = require('../../lib/issues');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'issue-state-'));
}

test('cerrar un issue open deja state closed', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    const issue = await setIssueState('r', base, 1, 'closed');
    assert.strictEqual(issue.state, 'closed');
    assert.strictEqual(issue.number, 1);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('reabrir un issue closed deja state open', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    await setIssueState('r', base, 1, 'closed');
    const issue = await setIssueState('r', base, 1, 'open');
    assert.strictEqual(issue.state, 'open');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('estado invalido lanza invalid_state', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    await assert.rejects(() => setIssueState('r', base, 1, 'bogus'), (e) => e instanceof IssueError && e.code === 'invalid_state');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('issue inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'T' });
    await assert.rejects(() => setIssueState('r', base, 99, 'closed'), (e) => e instanceof IssueError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});