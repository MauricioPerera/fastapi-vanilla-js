// Suite de routers HTTP (users + chat) que la batería de integración no cubría:
// levanta una app FastAPI in-process con ambos routers y ejercita los endpoints
// (incluido el ciclo de vida CRUD de usuarios, auto-limpiante).
const test = require('node:test');
const assert = require('node:assert');
const { FastAPI } = require('./lib/fastapi');
const userRouter = require('./routers/users');
const chatRouter = require('./routers/chat');
const { auth, ensureAuthInit } = require('./dependencies/auth');

const PORT = 8996;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'super-secret-token'; // bypass dev (NODE_ENV != production)
const TEST_EMAIL = 'router_test@example.com';
let server;

const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` };

test.before(async () => {
  const app = new FastAPI({ title: 'routers-test' });
  app.includeRouter(userRouter);
  app.includeRouter(chatRouter);
  server = app.listen(PORT);
  await new Promise(resolve => { server.listening ? resolve() : server.once('listening', resolve); });
  await ensureAuthInit();
  // Limpieza defensiva de una posible ejecución previa interrumpida (persistida a disco).
  const ex = auth.getUserByEmail(TEST_EMAIL);
  if (ex) { auth.deleteUser(ex._id); auth._users.flush(); }
});

test.after(() => { if (server) server.close(); });

// ── chat ────────────────────────────────────────────────────────────────────
test('POST /chat/copilot: messages válido (200) e inválido (400)', async () => {
  const ok = await fetch(`${BASE}/chat/copilot`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hola' }] })
  });
  assert.strictEqual(ok.status, 200);
  const body = await ok.json();
  assert.ok(body.resultado.response.includes('hola'));

  const bad = await fetch(`${BASE}/chat/copilot`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ messages: 'no-array' })
  });
  assert.strictEqual(bad.status, 400);
});

// ── users: GET ──────────────────────────────────────────────────────────────
test('GET /users: listado', async () => {
  const res = await fetch(`${BASE}/users`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data));
});

test('GET /users/:id: id numérico legacy y no encontrado', async () => {
  const num = await (await fetch(`${BASE}/users/5`)).json();
  assert.strictEqual(num.email, 'user5@test.com'); // emulación legacy
  const missing = await fetch(`${BASE}/users/noexiste_zzz`);
  assert.strictEqual(missing.status, 404);
});

// ── users: ciclo de vida CRUD (POST → PUT → DELETE), auto-limpiante ──────────
test('POST/PUT/DELETE /users: ciclo de vida completo', async (t) => {
  // Crear (requiere auth)
  const created = await fetch(`${BASE}/users`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ email: TEST_EMAIL, password: 'Secret123', name: 'Router Test' })
  });
  assert.strictEqual(created.status, 200);
  const id = (await created.json()).usuario._id;
  assert.ok(id);
  t.after(() => { const u = auth.getUserByEmail(TEST_EMAIL); if (u) { auth.deleteUser(u._id); auth._users.flush(); } });

  // Actualizar
  const updated = await fetch(`${BASE}/users/${id}`, {
    method: 'PUT', headers: authHeaders, body: JSON.stringify({ name: 'Actualizado' })
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual((await updated.json()).usuario.name, 'Actualizado');

  // Eliminar
  const deleted = await fetch(`${BASE}/users/${id}`, { method: 'DELETE', headers: authHeaders });
  assert.strictEqual(deleted.status, 200);

  // Ya no existe
  const gone = await fetch(`${BASE}/users/${id}`);
  assert.strictEqual(gone.status, 404);
});

test('POST /users: 400 si falta email/contraseña', async () => {
  const res = await fetch(`${BASE}/users`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'sin email' })
  });
  assert.strictEqual(res.status, 400);
});

test('PUT/DELETE /users/:id: 404 para id inexistente', async () => {
  const put = await fetch(`${BASE}/users/noexiste_zzz`, {
    method: 'PUT', headers: authHeaders, body: JSON.stringify({ name: 'x' })
  });
  assert.strictEqual(put.status, 404);
  const del = await fetch(`${BASE}/users/noexiste_zzz`, { method: 'DELETE', headers: authHeaders });
  assert.strictEqual(del.status, 404);
});
