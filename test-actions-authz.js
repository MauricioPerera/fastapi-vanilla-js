// Suite de autorización (RBAC) del router Actions: confirma que los dos endpoints de
// ESCRITURA (POST /repos/:name/workflows y POST /repos/:name/workflows/:wf/dispatch)
// exigen rol administrador (requireAdmin), mientras que los de LECTURA siguen sólo
// autenticados (getCurrentUser). Estilo test-routers.js: FastAPI in-process + node:test.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FastAPI } = require('./lib/fastapi');
const reposRouter = require('./routers/repos');
const actionsRouter = require('./routers/actions');
const { auth, ensureAuthInit } = require('./dependencies/auth');

const PORT = 8997;
const BASE = `http://localhost:${PORT}`;
const DEV_BYPASS_TOKEN = 'super-secret-token'; // bypass dev (NODE_ENV != production)

const REPO = 'actions-authz-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
const REPOS_DIR = path.join(__dirname, '.data', 'repos');
const BARE_DIR = path.join(REPOS_DIR, REPO + '.git');

const NONADMIN_EMAIL = 'actions_authz_user@example.com';
const ADMIN_EMAIL = 'actions_authz_admin@example.com';
const PASSWORD = 'Secret123';

let server;
let nonAdminToken;
let adminToken;
let adminUserId;
let nonAdminUserId;

function headers(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function req(method, pathStr, token, body) {
  const data = body ? JSON.stringify(body) : null;
  const h = data ? { 'Content-Type': 'application/json' } : {};
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + pathStr, { method, headers: h, body: data });
  let json;
  try { json = await res.json(); } catch (e) { json = null; }
  return { status: res.status, body: json };
}

test.before(async () => {
  const app = new FastAPI({ title: 'actions-authz-test' });
  app.includeRouter(reposRouter);
  app.includeRouter(actionsRouter);
  server = app.listen(PORT);
  await new Promise(resolve => { server.listening ? resolve() : server.once('listening', resolve); });
  await ensureAuthInit();

  // Limpieza defensiva de ejecuciones previas interrumpidas (persistido a disco).
  for (const email of [NONADMIN_EMAIL, ADMIN_EMAIL]) {
    const ex = auth.getUserByEmail(email);
    if (ex) { auth.deleteUser(ex._id); }
  }
  auth._users.flush();

  // Usuario NO-admin (roles: ['user']) y admin (roles: ['admin']) reales con JWT.
  const nonAdmin = await auth.register(NONADMIN_EMAIL, PASSWORD, { roles: ['user'], name: 'Non Admin' });
  nonAdminUserId = nonAdmin._id;
  const admin = await auth.register(ADMIN_EMAIL, PASSWORD, { roles: ['admin'], name: 'Admin' });
  adminUserId = admin._id;
  auth._users.flush();

  nonAdminToken = (await auth.login(NONADMIN_EMAIL, PASSWORD)).token;
  adminToken = (await auth.login(ADMIN_EMAIL, PASSWORD)).token;

  // Repo bare necesario como cwd donde corren los steps del dispatch.
  const created = await req('POST', '/repos', DEV_BYPASS_TOKEN, { name: REPO });
  assert.strictEqual(created.status, 200, 'crear repo bare de test');
});

test.after(async () => {
  // Borrar repo bare de test (como hace e2e-actions.js con DELETE /repos/:name).
  try { await req('DELETE', `/repos/${REPO}`, DEV_BYPASS_TOKEN); } catch (e) {}
  // Borrar usuarios de test.
  try {
    if (nonAdminUserId) auth.deleteUser(nonAdminUserId);
    if (adminUserId) auth.deleteUser(adminUserId);
    auth._users.flush();
  } catch (e) {}
  // Limpieza de workflows/runs del repo de test si quedaron en disco.
  for (const d of ['.data/workflows', '.data/runs']) {
    const p = path.join(__dirname, d, REPO);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  if (server) server.close();
});

// 1. Sin token -> 401 (getCurrentUser/requireAdmin autentica primero).
test('POST /repos/:name/workflows SIN token -> 401', async () => {
  const r = await req('POST', `/repos/${REPO}/workflows`, null, {
    name: 'wf-noauth', trigger: 'manual', steps: ['echo nope']
  });
  assert.strictEqual(r.status, 401);
});

// 2. Token de usuario NO-admin -> 403.
test('POST /repos/:name/workflows con token NO-admin -> 403', async () => {
  const r = await req('POST', `/repos/${REPO}/workflows`, nonAdminToken, {
    name: 'wf-forbidden', trigger: 'manual', steps: ['echo nope']
  });
  assert.strictEqual(r.status, 403);
});

// 3. Token admin (bypass dev 'super-secret-token') -> 200, workflow creado.
test('POST /repos/:name/workflows con token admin -> 200, workflow creado', async () => {
  const r = await req('POST', `/repos/${REPO}/workflows`, DEV_BYPASS_TOKEN, {
    name: 'wf-define', trigger: 'manual', steps: ['echo actions-authz-ok']
  });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body && r.body.workflow, 'debe devolver el workflow creado');
  assert.strictEqual(r.body.workflow.name, 'wf-define');
});

// 4. Dispatch con token NO-admin -> 403 y NO ejecuta el step.
test('POST /repos/:name/workflows/:wf/dispatch con token NO-admin -> 403 (no ejecuta el step)', async () => {
  // Workflow cuyo step escribe un marcador en el cwd del repo bare.
  const marker = path.join(BARE_DIR, 'dispatch-marker-noadmin.txt');
  if (fs.existsSync(marker)) fs.rmSync(marker, { force: true });
  const def = await req('POST', `/repos/${REPO}/workflows`, DEV_BYPASS_TOKEN, {
    name: 'wf-marker', trigger: 'manual',
    steps: [`echo ejecutado > dispatch-marker-noadmin.txt`]
  });
  assert.strictEqual(def.status, 200, 'definir wf-marker como admin');

  const r = await req('POST', `/repos/${REPO}/workflows/wf-marker/dispatch`, nonAdminToken, { event: 'manual' });
  assert.strictEqual(r.status, 403);
  // Confirma que el step NO se ejecutó: el marcador no debe existir.
  assert.strictEqual(fs.existsSync(marker), false, 'el step no debe ejecutarse sin rol admin');
});

// 5. Dispatch con token admin -> 200, ejecuta.
test('POST /repos/:name/workflows/:wf/dispatch con token admin -> 200, ejecuta', async () => {
  const r = await req('POST', `/repos/${REPO}/workflows/wf-define/dispatch`, DEV_BYPASS_TOKEN, { event: 'manual' });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body && r.body.run, 'debe devolver el run');
  assert.strictEqual(r.body.run.status, 'success');
  assert.ok(r.body.run.steps && r.body.run.steps.length > 0, 'debe tener steps');
  assert.strictEqual(r.body.run.steps[0].status, 'success');
  assert.ok(r.body.run.steps[0].stdout.includes('actions-authz-ok'), 'el step debe haberse ejecutado');
});

// 6. GET /repos/:name/workflows con token NO-admin (solo autenticado) -> 200.
//    Confirma que las rutas de LECTURA NO fueron tocadas.
test('GET /repos/:name/workflows con token NO-admin -> 200 (lectura sin cambio)', async () => {
  const r = await req('GET', `/repos/${REPO}/workflows`, nonAdminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(r.body && Array.isArray(r.body.workflows), 'debe devolver listado de workflows');
});