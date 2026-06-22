// Verificacion end-to-end contra el server en vivo (slice 3 Actions).
// Flujo: crear repo -> definir workflow -> dispatch -> ver run con logs.
// Ademas: auto-trigger issue_opened al crear un issue.
const http = require('http');
const assert = require('assert');

const PORT = process.env.E2E_PORT || 8011;
const BASE = `http://localhost:${PORT}`;
const REPO = 'e2e-actions-' + Date.now().toString(36);

function req(method, pathStr, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + pathStr, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(buf); } catch (e) { json = buf; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { await req('GET', '/'); return; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error('server no arranca');
}

async function main() {
  await waitForServer();
  console.log(`[e2e] server listo en ${BASE}`);

  // 1. Crear repo
  let r = await req('POST', '/repos', { name: REPO });
  assert.strictEqual(r.status, 200, 'crear repo');
  console.log(`[e2e] repo creado: ${REPO}`);

  // 2. Definir workflow manual
  r = await req('POST', `/repos/${REPO}/workflows`, {
    name: 'hello-wf',
    trigger: 'manual',
    steps: [{ name: 'saludo', command: 'echo hello-action' }]
  });
  assert.strictEqual(r.status, 200, 'definir workflow');
  console.log('[e2e] workflow definido:', r.body.workflow.name);

  // 3. Listar workflows
  r = await req('GET', `/repos/${REPO}/workflows`);
  assert.strictEqual(r.status, 200, 'listar workflows');
  assert.strictEqual(r.body.total, 1, 'debe haber 1 workflow');
  console.log('[e2e] workflows listados:', r.body.total);

  // 4. Dispatch manual
  r = await req('POST', `/repos/${REPO}/workflows/hello-wf/dispatch`);
  assert.strictEqual(r.status, 200, 'dispatch');
  const run = r.body.run;
  assert.ok(run && run.id, 'run tiene id');
  assert.strictEqual(run.status, 'success', 'run success');
  assert.strictEqual(run.steps.length, 1, '1 step');
  assert.ok(run.steps[0].stdout.includes('hello-action'), 'stdout capturado: ' + run.steps[0].stdout);
  assert.strictEqual(run.steps[0].exitCode, 0, 'exitCode 0');
  console.log('[e2e] dispatch OK -> run', run.id, 'status', run.status);

  // 5. Listar runs
  r = await req('GET', `/repos/${REPO}/runs`);
  assert.strictEqual(r.status, 200, 'listar runs');
  assert.strictEqual(r.body.total, 1, '1 run persistido');
  console.log('[e2e] runs listados:', r.body.total);

  // 6. Detalle/logs de un run
  r = await req('GET', `/repos/${REPO}/runs/${run.id}`);
  assert.strictEqual(r.status, 200, 'get run');
  assert.strictEqual(r.body.run.id, run.id, 'mismo run');
  assert.ok(r.body.run.steps[0].stdout.includes('hello-action'), 'logs del step');
  console.log('[e2e] detalle run OK, logs:', JSON.stringify(r.body.run.steps[0]).slice(0, 120));

  // 7. Auto-trigger: workflow con trigger issue_opened, crear issue, esperar, verificar run extra.
  r = await req('POST', `/repos/${REPO}/workflows`, {
    name: 'on-issue',
    trigger: 'issue_opened',
    steps: ['echo issue-triggered']
  });
  assert.strictEqual(r.status, 200, 'definir on-issue');
  r = await req('POST', `/repos/${REPO}/issues`, { title: 'probar trigger' });
  assert.strictEqual(r.status, 200, 'crear issue');
  console.log('[e2e] issue creado (debe disparar on-issue)');
  // fire-and-forget: esperar a que termine el run en background
  let runsAfter = 0;
  for (let i = 0; i < 20; i++) {
    await new Promise((res) => setTimeout(res, 300));
    const lr = await req('GET', `/repos/${REPO}/runs`);
    runsAfter = lr.body.total;
    if (runsAfter >= 2) break;
  }
  assert.ok(runsAfter >= 2, 'auto-trigger debe generar un run extra (total=' + runsAfter + ')');
  console.log('[e2e] auto-trigger OK, runs totales:', runsAfter);

  // 8. Error: dispatch de workflow inexistente -> 404
  r = await req('POST', `/repos/${REPO}/workflows/missing/dispatch`);
  assert.strictEqual(r.status, 404, 'dispatch inexistente 404');
  console.log('[e2e] dispatch inexistente -> 404 OK');

  // 9. Error: workflow invalido -> 400
  r = await req('POST', `/repos/${REPO}/workflows`, { name: 'bad', trigger: 'nope', steps: ['c'] });
  assert.strictEqual(r.status, 400, 'trigger invalido 400');
  console.log('[e2e] trigger invalido -> 400 OK');

  // Limpieza
  r = await req('DELETE', `/repos/${REPO}`);
  assert.strictEqual(r.status, 200, 'borrar repo');
  console.log('[e2e] repo borrado, TODO VERDE ✓');
}

main().catch((e) => { console.error('[e2e] FAIL:', e.message); process.exit(1); });