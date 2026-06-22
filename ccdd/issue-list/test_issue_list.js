// Property-tests congelados — contrato issue-list.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createIssue, listIssues, setIssueState, IssueError } = require('../../lib/issues');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'issue-list-'));
}

test('sin store devuelve [] y no crea archivo', async () => {
  const base = await tmpBase();
  try {
    const issues = await listIssues('r', base, 'all');
    assert.deepStrictEqual(issues, []);
    assert.ok(!fs.existsSync(path.join(base, 'r.json')));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('filtra por estado open dejando fuera closed', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'a' });
    await createIssue('r', base, { title: 'b' });
    await setIssueState('r', base, 2, 'closed');
    const open = await listIssues('r', base, 'open');
    assert.strictEqual(open.length, 1);
    assert.strictEqual(open[0].number, 1);
    const all = await listIssues('r', base, 'all');
    assert.strictEqual(all.length, 2);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('estado invalido lanza invalid_state', async () => {
  const base = await tmpBase();
  try {
    await createIssue('r', base, { title: 'a' });
    await assert.rejects(() => listIssues('r', base, 'bogus'), (e) => e instanceof IssueError && e.code === 'invalid_state');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});