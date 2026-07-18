// Suite de autorización (RBAC) de la superficie MCP SSE para los tools de ESCRITURA
// de actions: actions_upsert (crea workflow) y actions_dispatch (ejecuta shell). Confirma
// que un cliente MCP (SSE) autenticado PERO sin rol admin recibe un error JSON-RPC
// (code -32001) y el tool NO se ejecuta (sin workflow en disco / sin run), mientras que
// con rol admin el tool se ejecuta con éxito. Un tool NO marcado (actions_find) sigue
// funcionando igual para cualquier usuario autenticado.
//
// Estilo: test-sse.js (handshake SSE real + POST /message + lectura por el stream) +
// test-actions-authz.js (usuarios reales con JWT + bypass dev como admin).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FastAPI } = require('./lib/fastapi');
const { FastMCP } = require('./lib/fastmcp');
const { registerActionsPostalTools } = require('./lib/mcp-actions-postal-tools');
const { auth, ensureAuthInit } = require('./dependencies/auth');

const DEV_BYPASS_TOKEN = 'super-secret-token'; // bypass dev (NODE_ENV != production) -> admin
const NONADMIN_EMAIL = 'mcp_actions_authz_user@example.com';
const PASSWORD = 'Secret123';

// Mismos dirs base que lib/mcp-actions-postal-tools.js (.data/ en .gitignore).
const WORKFLOWS_DIR = path.join(__dirname, '.data', 'workflows');
const RUNS_DIR = path.join(__dirname, '.data', 'runs');

let BASE;
let server;
let nonAdminToken;
let nonAdminUserId;
const REPO = 'mcp-actions-authz-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);

// Lee del stream SSE hasta que `state.buffer` matchee `regex` (con timeout para no colgar CI).
async function readUntil(reader, decoder, state, regex, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const m = state.buffer.match(regex);
    if (m) return m;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timeout esperando SSE: ${regex}`);
    let timeoutId;
    const timeoutPromise = new Promise((_, rej) => {
      timeoutId = setTimeout(() => rej(new Error('read timeout')), remaining);
    });
    try {
      const chunk = await Promise.race([reader.read(), timeoutPromise]);
      if (chunk.done) throw new Error('stream SSE cerrado inesperadamente');
      state.buffer += decoder.decode(chunk.value, { stream: true });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Round-trip MCP sobre SSE real: abre el stream, negocia clientId, envía tools/call y
// devuelve la respuesta JSON-RPC leída del stream. Cierra el stream al terminar.
async function callTool(token, name, args) {
  const ac = new AbortController();
  try {
    const sse = await fetch(`${BASE}/sse`, {
      signal: ac.signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(sse.status, 200, `SSE debe abrir con token (got ${sse.status})`);
    const reader = sse.body.getReader();
    const decoder = new TextDecoder();
    const state = { buffer: '' };

    const ep = await readUntil(reader, decoder, state, /data: \/message\?client=(\S+)/);
    const clientId = ep[1];

    const post = await fetch(`${BASE}/message?client=${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    assert.strictEqual(post.status, 200, `POST /message debe aceptar con token (got ${post.status})`);
    assert.strictEqual((await post.json()).status, 'processed');

    const msgMatch = await readUntil(reader, decoder, state, /event: message\ndata: (.+)\n\n/);
    return JSON.parse(msgMatch[1]);
  } finally {
    ac.abort();
  }
}

test.before(async () => {
  const app = new FastAPI({ title: 'mcp-actions-authz-test' });
  const mcp = new FastMCP('mcp-actions-authz-test', { version: '0.0.0' });
  registerActionsPostalTools(mcp);
  mcp.setupSSE(app);
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });
  BASE = `http://localhost:${server.address().port}`;

  await ensureAuthInit();

  // Limpieza defensiva de ejecuciones previas interrumpidas (persistido a disco).
  const ex = auth.getUserByEmail(NONADMIN_EMAIL);
  if (ex) { auth.deleteUser(ex._id); }
  auth._users.flush();

  // Usuario NO-admin real (roles: ['user']) con JWT. El admin se representa con el
  // bypass de dev 'super-secret-token' (role 'administrator'), como test-actions-authz.js.
  const nonAdmin = await auth.register(NONADMIN_EMAIL, PASSWORD, { roles: ['user'], name: 'Non Admin' });
  nonAdminUserId = nonAdmin._id;
  auth._users.flush();
  nonAdminToken = (await auth.login(NONADMIN_EMAIL, PASSWORD)).token;
});

test.after(async () => {
  // Borrar usuarios de test y workflows/runs del repo de test si quedaron en disco.
  try {
    if (nonAdminUserId) { auth.deleteUser(nonAdminUserId); }
    auth._users.flush();
  } catch (e) {}
  for (const d of [WORKFLOWS_DIR, RUNS_DIR]) {
    const p = path.join(d, REPO);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  if (server) server.close();
});

// 1. actions_upsert con token NO-admin -> error JSON-RPC -32001, sin result, y el
//    workflow NO queda creado en disco (sin efectos secundarios).
test('actions_upsert con token NO-admin -> error JSON-RPC -32001 y no crea workflow', async () => {
  const wfName = 'wf-forbidden';
  const wfFile = path.join(WORKFLOWS_DIR, REPO, wfName + '.json');
  if (fs.existsSync(wfFile)) fs.rmSync(wfFile, { force: true });

  const resp = await callTool(nonAdminToken, 'actions_upsert', {
    name: REPO,
    body: { name: wfName, trigger: 'manual', steps: ['echo nope'] }
  });

  assert.ok(resp.error, 'debe devolver error JSON-RPC (no result)');
  assert.strictEqual(resp.error.code, -32001, 'code debe ser -32001 (Forbidden admin)');
  assert.ok(/admin/i.test(resp.error.message), 'message debe mencionar admin');
  assert.strictEqual(resp.result, undefined, 'no debe haber result en un error');
  assert.strictEqual(fs.existsSync(wfFile), false, 'el workflow NO debe quedar creado en disco');
});

// 2. actions_dispatch con token NO-admin -> error JSON-RPC -32001, sin run creado.
test('actions_dispatch con token NO-admin -> error JSON-RPC -32001 y no crea run', async () => {
  const runsDir = path.join(RUNS_DIR, REPO);
  if (fs.existsSync(runsDir)) fs.rmSync(runsDir, { recursive: true, force: true });

  const resp = await callTool(nonAdminToken, 'actions_dispatch', {
    name: REPO,
    wf: 'wf-inexistente'
  });

  assert.ok(resp.error, 'debe devolver error JSON-RPC (no result)');
  assert.strictEqual(resp.error.code, -32001, 'code debe ser -32001 (Forbidden admin)');
  assert.strictEqual(resp.result, undefined, 'no debe haber result en un error');
  // El handler nunca se invocó: no se crea el dir de runs del repo.
  assert.strictEqual(fs.existsSync(runsDir), false, 'no debe crearse run en disco');
});

// 3. actions_upsert con token admin (bypass dev) -> éxito, resultado normal, workflow en disco.
test('actions_upsert con token admin -> éxito y crea workflow', async () => {
  const wfName = 'wf-define';
  const wfFile = path.join(WORKFLOWS_DIR, REPO, wfName + '.json');

  const resp = await callTool(DEV_BYPASS_TOKEN, 'actions_upsert', {
    name: REPO,
    body: { name: wfName, trigger: 'manual', steps: ['echo mcp-actions-authz-ok'] }
  });

  assert.ok(resp.result, 'debe devolver result (no error)');
  assert.strictEqual(resp.result.isError, false);
  const payload = JSON.parse(resp.result.content[0].text);
  assert.strictEqual(payload.mensaje, 'Workflow definido');
  assert.strictEqual(payload.workflow.name, wfName);
  assert.strictEqual(fs.existsSync(wfFile), true, 'el workflow debe quedar creado en disco');
});

// 4. Un tool NO marcado (actions_find) con token NO-admin -> sigue funcionando igual
//    que antes (confirma que el gating no rompió el resto de la superficie).
test('actions_find con token NO-admin -> éxito (lectura sin cambio)', async () => {
  const resp = await callTool(nonAdminToken, 'actions_find', { name: REPO, mode: 'runs' });
  assert.ok(resp.result, 'debe devolver result (no error)');
  assert.strictEqual(resp.result.isError, false);
  const payload = JSON.parse(resp.result.content[0].text);
  assert.strictEqual(payload.mode, 'runs');
  assert.ok(Array.isArray(payload.runs), 'debe devolver listado de runs');
});