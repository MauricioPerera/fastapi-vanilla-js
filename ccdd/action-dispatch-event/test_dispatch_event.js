// Property-tests congelados — contrato action-dispatch-event.
// Oráculo independiente: escribe workflows con fs directo y cuenta runs persistidos con fs directo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { dispatchEvent } = require('../../lib/actions');
const { RepoError } = require('../../lib/gitRepos');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'disp-evt-'));
}

async function writeScript(base, body) {
  const file = path.join(base, 's_' + Math.random().toString(36).slice(2) + '.js');
  await fs.promises.writeFile(file, body, 'utf8');
  return file;
}

async function seedWorkflow(base, repo, wfName, trigger, script) {
  const dir = path.join(base, 'wfs', repo);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, wfName + '.json'), JSON.stringify({ name: wfName, trigger, steps: [{ command: 'node ' + script }] }));
}

function ctxOf(base) {
  return { workflowsDir: path.join(base, 'wfs'), runsDir: path.join(base, 'runs'), cwd: base };
}

test('1 issue_opened + 1 push: dispatchEvent(issue_opened) -> 1 run persistido', async () => {
  const base = await tmpBase();
  try {
    const s1 = await writeScript(base, "process.stdout.write('a')");
    const s2 = await writeScript(base, "process.stdout.write('b')");
    await seedWorkflow(base, 'r', 'on-issue', 'issue_opened', s1);
    await seedWorkflow(base, 'r', 'on-push', 'push', s2);
    const runs = await dispatchEvent('r', 'issue_opened', ctxOf(base));
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].workflow, 'on-issue');
    assert.strictEqual(runs[0].status, 'success');
    const runsDir = path.join(base, 'runs', 'r');
    const files = await fs.promises.readdir(runsDir);
    assert.strictEqual(files.length, 1);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('dispatchEvent(push) ejecuta solo el de push', async () => {
  const base = await tmpBase();
  try {
    const s1 = await writeScript(base, "process.stdout.write('a')");
    const s2 = await writeScript(base, "process.stdout.write('b')");
    await seedWorkflow(base, 'r', 'on-issue', 'issue_opened', s1);
    await seedWorkflow(base, 'r', 'on-push', 'push', s2);
    const runs = await dispatchEvent('r', 'push', ctxOf(base));
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].workflow, 'on-push');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('sin match devuelve [] y no persiste runs', async () => {
  const base = await tmpBase();
  try {
    const s = await writeScript(base, "process.stdout.write('x')");
    await seedWorkflow(base, 'r', 'on-push', 'push', s);
    const runs = await dispatchEvent('r', 'issue_opened', ctxOf(base));
    assert.deepStrictEqual(runs, []);
    assert.ok(!fs.existsSync(path.join(base, 'runs')));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('repoName con path traversal lanza invalid_name', async () => {
  const base = await tmpBase();
  try {
    await assert.rejects(() => dispatchEvent('../bad', 'push', ctxOf(base)), (e) => e instanceof RepoError && e.code === 'invalid_name');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});