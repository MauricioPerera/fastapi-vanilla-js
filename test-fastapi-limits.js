// Suite de límites del runtime Node (lib/fastapi.js): límite de body (413) y
// rate-limiting opt-in (createRateLimiter). Levanta apps FastAPI in-process en
// puertos libres y ejercita el status HTTP real con fetch. Estilo test-routers.js.
const test = require('node:test');
const assert = require('node:assert');
const { FastAPI, createRateLimiter } = require('./lib/fastapi');

const PORT_BODY = 8995;        // app con maxBodyBytes bajo + default
const PORT_RATE = 8994;        // app con rate limiter
const BODY_BASE = `http://localhost:${PORT_BODY}`;
const RATE_BASE = `http://localhost:${PORT_RATE}`;

// Contador global que el handler /echo incrementa. Sirve para probar que ante un
// 413 el handler NUNCA se ejecuta.
let echoCalls = 0;

let bodyServer; // app con maxBodyBytes bajo (ruta /echo)
let defaultServer; // app sin maxBodyBytes (ruta /default) — default 5MB
let rateServer;
let DEFAULT_BASE;

function listen(app, port) {
  const server = app.listen(port);
  return new Promise(resolve => {
    server.listening ? resolve(server) : server.once('listening', () => resolve(server));
  });
}

test.before(async () => {
  // ---- App de bodies: limite bajo (100 bytes) en /echo, default en /default ----
  // Una sola app con maxBodyBytes=100 global. /default valida que el DEFAULT de otra
  // app sigue funcionando (ver app aparte abajo, para no mezclar configs).
  const appLow = new FastAPI({ title: 'limits-test-low', maxBodyBytes: 100 });
  appLow.post('/echo', (req, res) => {
    echoCalls++;
    res.json({ ok: true, got: req.body });
  });
  bodyServer = await listen(appLow, PORT_BODY);

  // App aparte SIN maxBodyBytes (default 5MB) para confirmar que ~1KB sigue andando.
  const appDefault = new FastAPI({ title: 'limits-test-default' });
  appDefault.post('/default', (req, res) => res.json({ ok: true, len: JSON.stringify(req.body).length }));
  defaultServer = await listen(appDefault, PORT_BODY + 10);
  DEFAULT_BASE = `http://localhost:${PORT_BODY + 10}`;

  // ---- App de rate limiting ----
  const appRate = new FastAPI({ title: 'limits-test-rate' });
  appRate.addMiddleware(createRateLimiter({ windowMs: 200, max: 3 }));
  appRate.get('/ping', (req, res) => res.json({ ok: true }));
  rateServer = await listen(appRate, PORT_RATE);
});

test.after(() => {
  if (bodyServer) bodyServer.close();
  if (defaultServer) defaultServer.close();
  if (rateServer) rateServer.close();
});

// ── body limit ───────────────────────────────────────────────────────────────
test('POST /echo con body chico -> 200 (comportamiento sin cambios)', async () => {
  echoCalls = 0;
  const res = await fetch(`${BODY_BASE}/echo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg: 'hola' })
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(echoCalls, 1);
});

test('POST /echo con body > maxBodyBytes -> 413 y el handler NO se ejecuta', async () => {
  echoCalls = 0;
  // 200 bytes de payload: supera holgadamente el limite de 100.
  const big = JSON.stringify({ x: 'a'.repeat(200) });
  const res = await fetch(`${BODY_BASE}/echo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: big
  });
  assert.strictEqual(res.status, 413);
  const body = await res.json();
  assert.strictEqual(body.detail, 'Payload Too Large');
  // El handler de la ruta nunca debio ejecutarse.
  assert.strictEqual(echoCalls, 0);
});

test('POST /default con ~1KB y maxBodyBytes NO configurado (default) -> 200', async () => {
  const kb = JSON.stringify({ data: 'b'.repeat(1024) });
  assert.ok(Buffer.byteLength(kb) > 1000 && Buffer.byteLength(kb) < 5 * 1024 * 1024);
  const res = await fetch(`${DEFAULT_BASE}/default`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: kb
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
});

// ── rate limiter ─────────────────────────────────────────────────────────────
test('createRateLimiter: 3 requests -> 200, 4to -> 429, tras windowMs -> 200', async () => {
  // 3 seguidas dentro de la ventana (max:3)
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${RATE_BASE}/ping`);
    assert.strictEqual(r.status, 200, `request ${i + 1} debia ser 200`);
  }
  // 4to dentro de la misma ventana -> 429
  const blocked = await fetch(`${RATE_BASE}/ping`);
  assert.strictEqual(blocked.status, 429);
  const blockedBody = await blocked.json();
  assert.strictEqual(blockedBody.detail, 'Too Many Requests');

  // Esperamos a que pase la ventana (windowMs=200 -> 250ms) y vuelve a aceptar.
  await new Promise(r => setTimeout(r, 250));
  const after = await fetch(`${RATE_BASE}/ping`);
  assert.strictEqual(after.status, 200);
});