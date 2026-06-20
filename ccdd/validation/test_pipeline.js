// Test de integración: cableado de validate/serialize al pipeline de fastapi.js
// (opciones de ruta `model` y `responseModel`). Levanta un servidor real y usa fetch.
const test = require('node:test');
const assert = require('node:assert');
const { FastAPI } = require('../../lib/fastapi');

const PORT = 8987;
const BASE = `http://localhost:${PORT}`;
let server;

test.before(async () => {
  const app = new FastAPI({ title: 'pipeline-test' });

  // Ruta con validación tipada del body (modelo anidado estilo Pydantic).
  app.post('/signup', (req) => ({ ok: true, email: req.body.email }), {
    model: {
      type: 'object',
      properties: {
        email: { type: 'string', required: true, minLength: 3 },
        age: { type: 'integer', minimum: 0 },
        address: { type: 'object', properties: { city: { type: 'string', required: true } } }
      }
    }
  });

  // Ruta con response_model: la respuesta solo debe exponer id y name.
  app.get('/me', () => ({ id: 1, name: 'Ana', password: 'secreto', token: 'xyz' }), {
    responseModel: {
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } }
    }
  });

  server = app.listen(PORT);
  await new Promise(r => setTimeout(r, 150));
});

test.after(() => { if (server) server.close(); });

test('model: body válido pasa (200)', async () => {
  const res = await fetch(`${BASE}/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.c', age: 30, address: { city: 'Madrid' } })
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
});

test('model: body inválido → 422 con errores por ruta', async () => {
  const res = await fetch(`${BASE}/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'x', age: -1, address: {} })
  });
  assert.strictEqual(res.status, 422);
  const body = await res.json();
  assert.ok(Array.isArray(body.errors));
  const paths = body.errors.map(e => e.path);
  assert.ok(paths.includes('email'));        // minLength
  assert.ok(paths.includes('age'));           // minimum
  assert.ok(paths.includes('address.city'));  // required anidado
});

test('responseModel: la respuesta no expone password ni token', async () => {
  const res = await fetch(`${BASE}/me`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body, { id: 1, name: 'Ana' });
  assert.strictEqual(body.password, undefined);
  assert.strictEqual(body.token, undefined);
});
