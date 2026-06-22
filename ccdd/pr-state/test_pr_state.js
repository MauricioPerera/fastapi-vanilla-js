// Property-tests congelados — contrato pr-state.
// Oráculo independiente: escribe store con fs directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { setPullState, PullError } = require('../../lib/pulls');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pr-state-'));
}

async function seedStore(base, pulls) {
  const store = { repo: 'r', nextNumber: pulls.length + 1, pulls };
  await fs.promises.writeFile(path.join(base, 'r.json'), JSON.stringify(store, null, 2), 'utf8');
}

test('cierra un PR open', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [{ number: 1, title: 'T', head: 'h', base: 'main', state: 'open', comments: [] }]);
    const pull = await setPullState('r', base, 1, 'closed');
    assert.strictEqual(pull.state, 'closed');
    const store = JSON.parse(await fs.promises.readFile(path.join(base, 'r.json'), 'utf8'));
    assert.strictEqual(store.pulls[0].state, 'closed');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('reabre un PR closed', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [{ number: 1, title: 'T', head: 'h', base: 'main', state: 'closed', comments: [] }]);
    const pull = await setPullState('r', base, 1, 'open');
    assert.strictEqual(pull.state, 'open');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('merged no es valido aqui lanza invalid_state', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [{ number: 1, title: 'T', head: 'h', base: 'main', state: 'open', comments: [] }]);
    await assert.rejects(() => setPullState('r', base, 1, 'merged'), (e) => e instanceof PullError && e.code === 'invalid_state');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('numero inexistente lanza not_found', async () => {
  const base = await tmpBase();
  try {
    await seedStore(base, [{ number: 1, title: 'T', head: 'h', base: 'main', state: 'open', comments: [] }]);
    await assert.rejects(() => setPullState('r', base, 99, 'open'), (e) => e instanceof PullError && e.code === 'not_found');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});