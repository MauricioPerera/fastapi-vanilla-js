// Verificacion end-to-end de la emision Postal sobre PR + ACTIONS (iteracion 2).
// Flujo: crear repo + ramas (git) -> issue -> PR (created) -> comentar PR -> close/reopen
//   -> definir workflow (workflow.defined) -> dispatch run (run.started + run.completed)
//   -> merge PR (pr.merged) -> leer timeline: TODOS los eventos de issues+PR+actions en orden
//   -> projector reconstruye estado con pulls (merged + mergeCommitSha) y runs (status/exitCode).
// Self-contained: spawnea el server en un puerto, corre el flujo y lo mata.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const assert = require('assert');

const PORT = process.env.E2E_PORT || 8013;
const BASE = `http://localhost:${PORT}`;
const REPO = 'e2e-postal-pa-' + Date.now().toString(36);
const BARE = path.join(process.cwd(), '.data', 'repos', REPO + '.git');

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
        let json; try { json = JSON.parse(buf); } catch (e) { json = buf; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout) => err ? reject(err) : resolve(stdout));
  });
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      http.get(BASE + '/', (res) => { res.resume(); resolve(); }).on('error', () => {
        if (++tries > 80) reject(new Error('server no arranca'));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

// Puebla el bare con main (1 commit) y feat (1 commit extra) via clone + push.
async function setupBranches() {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'e2e-pa-clone-'));
  try {
    await git(['clone', BARE, tmp]);
    await git(['-C', tmp, 'config', 'user.email', 'e2e@local']);
    await git(['-C', tmp, 'config', 'user.name', 'E2E']);
    await fs.promises.writeFile(path.join(tmp, 'f.txt'), 'base');
    await git(['-C', tmp, 'add', '.']);
    await git(['-C', tmp, 'commit', '-m', 'init']);
    await git(['-C', tmp, 'branch', '-M', 'main']);
    await git(['-C', tmp, 'push', 'origin', 'main']);
    await git(['-C', tmp, 'checkout', '-b', 'feat']);
    await fs.promises.writeFile(path.join(tmp, 'g.txt'), 'nuevo');
    await git(['-C', tmp, 'add', '.']);
    await git(['-C', tmp, 'commit', '-m', 'feat change']);
    await git(['-C', tmp, 'push', 'origin', 'feat']);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// Espera hasta que `pred(timelineBody)` sea true o agota intentos.
async function waitUntil(kind, pred) {
  for (let i = 0; i < 40; i++) {
    const tl = await req('GET', `/repos/${REPO}/timeline`);
    if (pred(tl.body)) return tl.body;
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error('timeout esperando: ' + kind);
}

async function main() {
  const server = spawn(process.execPath, ['index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit'
  });
  try {
    await waitForServer();
    console.log(`[e2e-pa] server listo en ${BASE}`);

    // 1. Crear repo + ramas
    let r = await req('POST', '/repos', { name: REPO });
    assert.strictEqual(r.status, 200, 'crear repo');
    await setupBranches();
    console.log('[e2e-pa] repo + ramas main/feat listos');

    // 2. Issue -> issue.created
    r = await req('POST', `/repos/${REPO}/issues`, { title: 'Bug PA', agent: 'agent-alice' });
    assert.strictEqual(r.status, 200, 'crear issue');
    await waitUntil('issue.created', (b) => b.timeline && b.timeline.some((t) => t.kind === 'issue.created'));

    // 3. PR -> pr.created
    r = await req('POST', `/repos/${REPO}/pulls`, { title: 'Agrega g', head: 'feat', base: 'main', agent: 'agent-alice' });
    assert.strictEqual(r.status, 200, 'crear PR');
    const pullNumber = r.body.pull.number;
    await waitUntil('pr.created', (b) => b.timeline && b.timeline.some((t) => t.kind === 'pr.created'));

    // 4. Comentar PR -> pr.commented
    r = await req('POST', `/repos/${REPO}/pulls/${pullNumber}/comments`, { author: 'agent-bob', body: 'lgtm' });
    assert.strictEqual(r.status, 200, 'comentar PR');
    await waitUntil('pr.commented', (b) => b.timeline && b.timeline.some((t) => t.kind === 'pr.commented'));

    // 5. Cerrar/reabrir PR -> pr.state_changed x2
    await req('POST', `/repos/${REPO}/pulls/${pullNumber}/state`, { state: 'closed', agent: 'agent-alice' });
    await req('POST', `/repos/${REPO}/pulls/${pullNumber}/state`, { state: 'open', agent: 'agent-alice' });
    await waitUntil('pr.state_changed x2', (b) => b.timeline && b.timeline.filter((t) => t.kind === 'pr.state_changed').length >= 2);

    // 6. Definir workflow (manual) -> workflow.defined
    r = await req('POST', `/repos/${REPO}/workflows`, { name: 'ci', trigger: 'manual', steps: ['echo ok'], agent: 'agent-alice' });
    assert.strictEqual(r.status, 200, 'definir workflow');
    await waitUntil('workflow.defined', (b) => b.timeline && b.timeline.some((t) => t.kind === 'workflow.defined'));

    // 7. Dispatch run -> run.started + run.completed (serializados, mismo agente)
    r = await req('POST', `/repos/${REPO}/workflows/ci/dispatch`, { event: 'manual', agent: 'agent-alice' });
    assert.strictEqual(r.status, 200, 'dispatch run');
    const runId = r.body.run.id;
    assert.strictEqual(r.body.run.status, 'success', 'run success');
    await waitUntil('run.completed', (b) => b.timeline && b.timeline.some((t) => t.kind === 'run.completed'));
    await waitUntil('run.started', (b) => b.timeline && b.timeline.some((t) => t.kind === 'run.started'));

    // 8. Merge PR -> pr.merged (con mergeCommitSha)
    r = await req('POST', `/repos/${REPO}/pulls/${pullNumber}/merge`, { agent: 'agent-alice' });
    assert.strictEqual(r.status, 200, 'merge PR');
    const mergeSha = r.body.pull.mergeCommitSha;
    assert.ok(mergeSha, 'mergeCommitSha presente');
    await waitUntil('pr.merged', (b) => b.timeline && b.timeline.some((t) => t.kind === 'pr.merged'));

    // 9. Timeline: TODOS los kinds presentes en orden cronologico (por created_at)
    const tl = await req('GET', `/repos/${REPO}/timeline`);
    const kinds = tl.body.timeline.map((t) => t.kind);
    const expectedOrder = ['issue.created', 'pr.created', 'pr.commented', 'pr.state_changed', 'pr.state_changed', 'workflow.defined', 'run.started', 'run.completed', 'pr.merged'];
    for (const k of expectedOrder) {
      assert.ok(kinds.includes(k), 'timeline contiene ' + k);
    }
    // Orden: indices de cada kind deben ser crecientes respecto al bloque anterior
    function firstIdx(kk) { return kinds.indexOf(kk); }
    assert.ok(firstIdx('issue.created') < firstIdx('pr.created'), 'orden issue->pr');
    assert.ok(firstIdx('pr.created') < firstIdx('workflow.defined'), 'orden pr->workflow');
    assert.ok(firstIdx('workflow.defined') < firstIdx('run.started'), 'orden workflow->run.started');
    assert.ok(firstIdx('run.started') < firstIdx('run.completed'), 'orden run.started->run.completed');
    assert.ok(firstIdx('run.completed') < firstIdx('pr.merged'), 'orden run.completed->pr.merged');
    console.log('[e2e-pa] timeline con TODOS los kinds en orden OK:', kinds.join(' -> '));

    // 10. Estado proyectado: pulls (merged + sha) y runs (status + exitCode)
    const st = await req('GET', `/repos/${REPO}/state`);
    const pulls = st.body.state.pulls || {};
    const runs = st.body.state.runs || {};
    assert.ok(pulls[String(pullNumber)], 'estado tiene pull proyectado');
    assert.strictEqual(pulls[String(pullNumber)].state, 'merged', 'pull merged en estado');
    assert.strictEqual(pulls[String(pullNumber)].mergeCommitSha, mergeSha, 'mergeCommitSha en estado');
    assert.ok(runs[runId], 'estado tiene run proyectado');
    assert.strictEqual(runs[runId].status, 'success', 'run success en estado');
    assert.strictEqual(runs[runId].exitCode, 0, 'run exitCode 0 en estado');
    assert.ok(st.body.state.workflows && st.body.state.workflows['ci'], 'workflow ci en estado');
    assert.ok(st.body.state.issues && st.body.state.issues['1'], 'issue #1 sigue en estado (regresion)');
    console.log('[e2e-pa] projector reconstruye estado con pulls(merged+sha) y runs(success+exit) OK');

    // 11. Cadena intacta: sin fallos
    assert.strictEqual(tl.body.failures.length, 0, 'sin fallos de cadena');
    assert.ok(tl.body.verified >= expectedOrder.length, 'eventos verificados');
    console.log('[e2e-pa] cadena verificada: total', tl.body.total, 'verified', tl.body.verified, 'failures', tl.body.failures.length);

    // Limpieza
    r = await req('DELETE', `/repos/${REPO}`);
    assert.strictEqual(r.status, 200, 'borrar repo');
    console.log('[e2e-pa] repo borrado, TODO VERDE ✓');
  } finally {
    server.kill('SIGTERM');
  }
}

const { spawn } = require('child_process');
main().catch((e) => { console.error('[e2e-pa] FAIL:', e.message); process.exit(1); });