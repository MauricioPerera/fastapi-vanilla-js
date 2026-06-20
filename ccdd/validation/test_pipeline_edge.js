// Integración Edge: cableado de validate/serialize en lib/fastapi-edge.js
// (opciones de ruta `model` y `responseModel`), vía app.handle(Request, env, ctx).
const test = require('node:test');
const assert = require('node:assert');

let app;

test.before(async () => {
  const { FastAPI } = await import('../../lib/fastapi-edge.js');
  app = new FastAPI({ title: 'edge-pipeline-test' });

  app.post('/signup', () => ({ ok: true }), {
    model: {
      type: 'object',
      properties: {
        email: { type: 'string', required: true, minLength: 3 },
        age: { type: 'integer', minimum: 0 },
        address: { type: 'object', properties: { city: { type: 'string', required: true } } }
      }
    }
  });

  app.get('/me', () => ({ id: 1, name: 'Ana', password: 'secreto', token: 'xyz' }), {
    responseModel: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } }
  });
});

const post = (path, obj) => app.handle(
  new Request(`http://edge${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj)
  }), {}, {}
);

test('edge model: body válido (200)', async () => {
  const res = await post('/signup', { email: 'a@b.c', age: 30, address: { city: 'Madrid' } });
  assert.strictEqual(res.status, 200);
});

test('edge model: body inválido → 422 con paths', async () => {
  const res = await post('/signup', { email: 'x', age: -1, address: {} });
  assert.strictEqual(res.status, 422);
  const body = await res.json();
  const paths = body.errors.map(e => e.path);
  assert.ok(paths.includes('email'));
  assert.ok(paths.includes('age'));
  assert.ok(paths.includes('address.city'));
});

test('edge responseModel: no expone password ni token', async () => {
  const res = await app.handle(new Request('http://edge/me'), {}, {});
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body, { id: 1, name: 'Ana' });
});
