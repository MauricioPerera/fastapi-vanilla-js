// Property-tests congelados — contrato pr-list.
// Oráculo independiente: escribe el store con fs directo (no importa internos del target).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { listPulls, PullError } = require('../../lib/pulls');
const { RepoError } = require('../../lib/gitRepos');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-list-'));
}

async function seedStore(base, pulls) {
  const store = { repo: 'r', nextNumber: pulls.length + 1, pulls };
  await fs.promises.writeFile(path.join(base, 'r.json'), JSON.stringify(store, null, 2), 'utf8');
}

const FIXTURE = [
  { number: 1, title: 'a', head: 'h', base: 'main', state: 'open', comments: [] },
  { number: 2, title: 'b', head: 'h', base: 'main', state: 'open', comments: [] },
  { number: 3, title: 'c', head: 'h', base: 'main', state: 'closed', comments: [] },
  { number: 4, title: 'd', head: 'h', base: 'main', state: 'merged', comments: [] }
];

test('sin filtro devuelve todos', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, FIXTURE);
    const all = await listPulls('r', base);
    assert.strictEqual(all.length, 4);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('filtro open devuelve 2', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, FIXTURE);
    const open = await listPulls('r', base, 'open');
    assert.strictEqual(open.length, 2);
    assert.ok(open.every((p) => p.state === 'open'));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('filtro closed y merged', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, FIXTURE);
    assert.strictEqual((await listPulls('r', base, 'closed')).length, 1);
    assert.strictEqual((await listPulls('r', base, 'merged')).length, 1);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('filtro all devuelve todos', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, FIXTURE);
    assert.strictEqual((await listPulls('r', base, 'all')).length, 4);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('filtro invalido lanza invalid_state', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, FIXTURE);
    await assert.rejects(() => listPulls('r', base, 'bogus'), (e) => e instanceof PullError && e.code === 'invalid_state');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('repo sin store -> []', async () => {
  const base = await tmpBase();
  try {
    const empty = await listPulls('nuevo', base);
    assert.deepStrictEqual(empty, []);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});