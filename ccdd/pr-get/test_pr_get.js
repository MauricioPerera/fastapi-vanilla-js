// Property-tests congelados — contrato pr-get.
// Oráculo independiente: escribe store con fs directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getPull, PullError } = require('../../lib/pulls');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-get-'));
}

async function seedStore(base, pulls) {
  const store = { repo: 'r', nextNumber: pulls.length + 1, pulls };
  await fs.promises.writeFile(path.join(base, 'r.json'), JSON.stringify(store, null, 2), 'utf8');
}

test('obtiene PR existente', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [{ number: 1, title: 'T', head: 'h', base: 'main', state: 'open', comments: [] }]);
    const pull = await getPull('r', base, 1);
    assert.strictEqual(pull.number, 1);
    assert.strictEqual(pull.title, 'T');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('numero inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [{ number: 1, title: 'T', head: 'h', base: 'main', state: 'open', comments: [] }]);
    await assert.rejects(() => getPull('r', base, 99), (e) => e instanceof PullError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('repo sin store lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => getPull('nuevo', base, 1), (e) => e instanceof PullError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});