// Property-tests congelados — contrato pr-comment-list.
// Oráculo independiente: escribe store con fs directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { listPullComments, PullError } = require('../../lib/pulls');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-comment-list-'));
}

async function seedStore(base, pulls) {
  const store = { repo: 'r', nextNumber: pulls.length + 1, pulls };
  await fs.promises.writeFile(path.join(base, 'r.json'), JSON.stringify(store, null, 2), 'utf8');
}

test('lista comentarios de un PR', async () => {
  const base = await tmpBase();
  try {
    const pr = { number: 1, title: 'T', head: 'h', base: 'main', state: 'open', comments: [
      { author: 'A', body: 'b1', createdAt: 't1' }, { author: 'B', body: 'b2', createdAt: 't2' }
    ] };
    await seedStore(base, [pr]);
    const comments = await listPullComments('r', base, 1);
    assert.strictEqual(comments.length, 2);
    assert.strictEqual(comments[0].body, 'b1');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('PR sin comentarios -> []', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [{ number: 1, title: 'T', head: 'h', base: 'main', state: 'open', comments: [] }]);
    const comments = await listPullComments('r', base, 1);
    assert.deepStrictEqual(comments, []);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('PR inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [{ number: 1, title: 'T', head: 'h', base: 'main', state: 'open', comments: [] }]);
    await assert.rejects(() => listPullComments('r', base, 99), (e) => e instanceof PullError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});