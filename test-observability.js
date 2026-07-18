// Suite de observabilidad del runtime Node (index.js):
//  - GET /health público (200 ok / 503 degraded) con check REAL de db
//  - middleware de logging: modo JSON sólo con LOG_FORMAT=json; default de texto idéntico
//
// Testea el index.js REAL: setea un PORT único y lo requiere (index.js ya exporta `app`
// y ya llama app.listen(PORT) al cargar). Cierra app.server al final. No modifica index.js.
const test = require('node:test');
const assert = require('node:assert');

const PORT = 8995;
const BASE = `http://localhost:${PORT}`;

let app;

test.before(async () => {
  // Arranca el index.js real en un puerto único. El default de logging es texto
  // (sin LOG_FORMAT), que es lo que ejercitan los tests de la batería.
  process.env.PORT = String(PORT);
  delete process.env.LOG_FORMAT;
  app = require('./index.js');
  // Espera a que el server http esté escuchando antes de pegarle.
  await new Promise((resolve) => {
    if (app.server && app.server.listening) return resolve();
    app.server.once('listening', resolve);
  });
});

test.after(() => {
  if (app && app.server) app.server.close();
});

// Serializa los subtests: los de logging mutan process.env y console.log, no
// pueden correr en paralelo contra el health ni entre sí.
test('observability', { concurrency: 1 }, async (t) => {
  // ── /health: 200 ok con cuerpo bien formado ───────────────────────────────
  await t.test('GET /health -> 200, status ok, uptime numérico, timestamp ISO, checks.db true', async () => {
    const res = await fetch(`${BASE}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(typeof body.uptime, 'number');
    assert.ok(!Number.isNaN(body.uptime), 'uptime no debe ser NaN');
    assert.ok(body.uptime >= 0);
    // timestamp parseable como fecha ISO válida
    const d = new Date(body.timestamp);
    assert.ok(!Number.isNaN(d.getTime()), 'timestamp debe ser una fecha válida');
    assert.strictEqual(body.checks.db, true);
  });

  // ── /health: público, sin auth (no exige Authorization) ────────────────────
  await t.test('GET /health sin Authorization -> 200 (no 401)', async () => {
    const res = await fetch(`${BASE}/health`, { headers: {} });
    assert.strictEqual(res.status, 200);
  });

  // ── /health: 503 degraded cuando el check de db falla ─────────────────────
  await t.test('GET /health -> 503 degraded si db falla (check real, no hardcodeado)', async () => {
    const db = require('./dependencies/db');
    const origCollection = db.collection.bind(db);
    db.collection = () => { throw new Error('simulated db down'); };
    try {
      const res = await fetch(`${BASE}/health`);
      assert.strictEqual(res.status, 503);
      const body = await res.json();
      assert.strictEqual(body.status, 'degraded');
      assert.strictEqual(body.checks.db, false);
      assert.ok(body.detail && body.detail.db, 'debe detallar qué falló');
    } finally {
      db.collection = origCollection;
    }
  });

  // ── logging: modo JSON con LOG_FORMAT=json ────────────────────────────────
  await t.test('logging con LOG_FORMAT=json emite una línea JSON parseable con las claves', async () => {
    process.env.LOG_FORMAT = 'json';
    const captured = [];
    const origLog = console.log;
    console.log = (...args) => { captured.push(args.map(String).join(' ')); };
    try {
      await fetch(`${BASE}/`);
      // El middleware loguea después de next(); darle un instante a que flushee.
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      console.log = origLog;
      delete process.env.LOG_FORMAT;
    }
    const line = captured.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    assert.ok(line, 'debe emitirse al menos una línea JSON parseable');
    const obj = JSON.parse(line);
    assert.ok(obj.timestamp, 'falta timestamp');
    assert.strictEqual(typeof obj.method, 'string');
    assert.ok(obj.path !== undefined, 'falta path');
    assert.ok(obj.status !== undefined, 'falta status');
    assert.strictEqual(typeof obj.durationMs, 'number');
  });

  // ── logging: default de texto (sin LOG_FORMAT) sin cambiar ────────────────
  await t.test('logging default (sin LOG_FORMAT) sigue siendo texto coloreado, no JSON', async () => {
    delete process.env.LOG_FORMAT;
    const captured = [];
    const origLog = console.log;
    console.log = (...args) => { captured.push(args.map(String).join(' ')); };
    try {
      await fetch(`${BASE}/`);
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      console.log = origLog;
    }
    // La línea de texto del middleware contiene "Status:" y códigos ANSI de color.
    const line = captured.find((l) => l.includes('Status:'));
    assert.ok(line, 'debe emitirse la línea de texto con "Status:"');
    assert.ok(line.includes('\x1b['), 'debe contener códigos ANSI de color (formato default)');
    assert.throws(() => JSON.parse(line), SyntaxError, 'la línea de texto no debe ser JSON parseable');
  });
});