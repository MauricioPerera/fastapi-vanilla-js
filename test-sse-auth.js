// Verificacion del hardening de auth sobre la superficie MCP SSE (GET /sse,
// POST /message en lib/fastmcp.js::setupSSE). Self-contained, un solo proceso,
// termina solo. Prueba: SIN token -> 401; CON token dev -> 200 text/event-stream.
const http = require('http');
const assert = require('assert');
const { FastAPI } = require('./lib/fastapi');
const { FastMCP } = require('./lib/fastmcp');
const { registerSystemFeatures } = require('./lib/mcp-features');

const TOKEN = 'super-secret-token'; // bypass dev (NODE_ENV != production)
let BASE;

function req(method, pathStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(BASE + pathStr, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
      res.on('error', reject);
    });
    r.on('error', reject);
    r.end();
  });
}

// GET /sse: el stream nunca termina; lee status + headers + primer chunk (el
// `event: endpoint`) y destruye el socket de inmediato para no colgar.
function sseGet(pathStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(BASE + pathStr, { method: 'GET', headers }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c.toString();
        if (buf.includes('event: endpoint')) {
          res.destroy(); // ya tenemos el primer evento; cerrar el stream
          resolve({ status: res.statusCode, headers: res.headers, body: buf });
        }
      });
      res.on('error', reject);
    });
    r.on('error', reject);
    r.end();
  });
}

async function main() {
  const app = new FastAPI({ title: 'sse-auth-verify' });
  const mcp = new FastMCP('sse-auth-verify', { version: '0.0.0' });
  registerSystemFeatures(mcp);
  mcp.setupSSE(app);
  const server = app.listen(0);
  await new Promise((res, rej) => {
    if (server.listening) return res();
    server.once('listening', res);
    server.once('error', rej);
  });
  const PORT = server.address().port;
  BASE = `http://localhost:${PORT}`;

  let failures = 0;

  // 1. GET /sse SIN token -> 401 (no abre stream)
  const noAuth = await req('GET', '/sse');
  const ok401 = noAuth.status === 401;
  console.log(`${ok401 ? 'OK' : 'FAIL'} SIN token  GET /sse -> ${noAuth.status} (esperado 401)`);
  if (!ok401) failures++;

  // 2. GET /sse CON token dev -> 200 + Content-Type text/event-stream
  const withAuth = await sseGet('/sse', { Authorization: `Bearer ${TOKEN}` });
  const ok200 = withAuth.status === 200
    && (withAuth.headers['content-type'] || '').includes('text/event-stream');
  console.log(`${ok200 ? 'OK' : 'FAIL'} CON token  GET /sse -> ${withAuth.status} ${withAuth.headers['content-type']} (esperado 200 text/event-stream)`);
  if (!ok200) failures++;
  // El stream debe anunciar el endpoint /message?client=...
  console.log(`${withAuth.body.includes('event: endpoint') ? 'OK' : 'FAIL'} stream SSE emite 'event: endpoint'`);
  if (!withAuth.body.includes('event: endpoint')) failures++;

  // 3. POST /message SIN token -> 401
  const postNoAuth = await req('POST', '/message?client=x',
    { 'Content-Type': 'application/json' });
  const okPost401 = postNoAuth.status === 401;
  console.log(`${okPost401 ? 'OK' : 'FAIL'} SIN token  POST /message -> ${postNoAuth.status} (esperado 401)`);
  if (!okPost401) failures++;

  server.close();
  if (failures > 0) {
    console.error(`\n✗ ${failures} comprobaciones fallaron`);
    process.exit(1);
  }
  console.log('\n✓ Hardening SSE verificado: SIN token -> 401, CON token -> 200/event');
  process.exit(0);
}

main().catch((e) => { console.error('verify FAIL:', e.message); process.exit(1); });