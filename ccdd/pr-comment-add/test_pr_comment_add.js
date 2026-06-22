// Property-tests congelados — contrato pr-comment-add.
// Oráculo independiente: escribe store con fs directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { addPullComment, PullError } = require('../../lib/pulls');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-comment-add-'));
}

async function seedStore(base, pulls) {
  const store = { repo: 'r', nextNumber: pulls.length + 1, pulls };
  await fs.promises.writeFile(path.join(base, 'r.json'), JSON.stringify(store, null, 2), 'utf8');
}

const PR = { number: 1, title: 'T', head: 'h', base: 'main', state: 'open', createdAt: 't0', updatedAt: 't0', comments: [] };

test('añade comentario con author', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [JSON.parse(JSON.stringify(PR))]);
    const c = await addPullComment('r', base, 1, { author: 'Ana', body: 'lgtm' });
    assert.strictEqual(c.author, 'Ana');
    assert.strictEqual(c.body, 'lgtm');
    assert.ok(c.createdAt);
    const store = JSON.parse(await fs.promises.readFile(path.join(base, 'r.json'), 'utf8'));
    assert.strictEqual(store.pulls[0].comments.length, 1);
    assert.strictEqual(store.pulls[0].updatedAt, c.createdAt);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('author default anonymous', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [JSON.parse(JSON.stringify(PR))]);
    const c = await addPullComment('r', base, 1, { body: 'x' });
    assert.strictEqual(c.author, 'anonymous');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('body vacio lanza invalid_body', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [JSON.parse(JSON.stringify(PR))]);
    await assert.rejects(() => addPullComment('r', base, 1, { author: 'A' }), (e) => e instanceof PullError && e.code === 'invalid_body');
    await assert.rejects(() => addPullComment('r', base, 1, { body: '   ' }), (e) => e instanceof PullError && e.code === 'invalid_body');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('PR inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [JSON.parse(JSON.stringify(PR))]);
    await assert.rejects(() => addPullComment('r', base, 99, { body: 'x' }), (e) => e instanceof PullError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});