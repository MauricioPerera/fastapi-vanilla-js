// Property-tests congelados — contrato action-run-step.
// Oráculo independiente: usa scripts node temporales y verifica cwd/salida/código.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runStep } = require('../../lib/actions');

async function tmpBase() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'run-step-'));
}

async function writeScript(base, body) {
  const file = path.join(base, 's_' + Math.random().toString(36).slice(2) + '.js');
  await fs.promises.writeFile(file, body, 'utf8');
  return file;
}

test('step exitoso: success, exitCode 0, stdout con la salida', async () => {
  const base = await tmpBase();
  try {
    const script = await writeScript(base, "process.stdout.write('hello-step')");
    const res = await runStep({ command: 'node ' + script, name: 'say' }, base);
    assert.strictEqual(res.status, 'success');
    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(res.stdout, 'hello-step');
    assert.strictEqual(res.name, 'say');
    assert.strictEqual(res.command, 'node ' + script);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('step string se normaliza y se ejecuta', async () => {
  const base = await tmpBase();
  try {
    const script = await writeScript(base, "process.stdout.write('x')");
    const res = await runStep('node ' + script, base);
    assert.strictEqual(res.status, 'success');
    assert.strictEqual(res.stdout, 'x');
    assert.strictEqual(res.name, 'node ' + script);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('step fallido (exit 3): failure, exitCode 3', async () => {
  const base = await tmpBase();
  try {
    const script = await writeScript(base, "process.stderr.write('boom'); process.exit(3)");
    const res = await runStep({ command: 'node ' + script }, base);
    assert.strictEqual(res.status, 'failure');
    assert.strictEqual(res.exitCode, 3);
    assert.ok(res.stderr.includes('boom'));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('cwd se respeta: el proceso corre en el tmpdir', async () => {
  const base = await tmpBase();
  try {
    const script = await writeScript(base, "process.stdout.write(process.cwd())");
    const res = await runStep({ command: 'node ' + script }, base);
    assert.strictEqual(res.status, 'success');
    assert.strictEqual(res.stdout, base);
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});

test('step invalido devuelve failure sin lanzar', async () => {
  const base = await tmpBase();
  try {
    const res = await runStep({ command: 5 }, base);
    assert.strictEqual(res.status, 'failure');
    assert.strictEqual(res.exitCode, 1);
    assert.strictEqual(res.stderr, 'step inválido');
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});