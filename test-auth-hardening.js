// Verificacion del hardening de auth sobre los 5 routers nuevos (repos, issues,
// pulls, actions, postal). Self-contained, un solo proceso, termina solo.
// Prueba: SIN token -> 401; CON token dev (super-secret-token) -> 200.
const http = require('http');
const assert = require('assert');
const { FastAPI } = require('./lib/fastapi');
const reposRouter = require('./routers/repos');
const issuesRouter = require('./routers/issues');
const pullsRouter = require('./routers/pulls');
const actionsRouter = require('./routers/actions');
const postalRouter = require('./routers/postal');

const PORT = 8997;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'super-secret-token'; // bypass dev (NODE_ENV != production)

function req(method, pathStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(BASE + pathStr, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    r.on('error', reject);
    r.end();
  });
}

async function main() {
  const app = new FastAPI({ title: 'auth-hardening-verify' });
  app.includeRouter(reposRouter);
  app.includeRouter(issuesRouter);
  app.includeRouter(pullsRouter);
  app.includeRouter(actionsRouter);
  app.includeRouter(postalRouter);
  const server = app.listen(PORT);
  await new Promise((res, rej) => {
    if (server.listening) return res();
    server.once('listening', res);
    server.once('error', rej);
  });

  let failures = 0;
  const endpoints = [
    '/repos',                           // repos router
    '/repos/x/issues',                  // issues router
    '/repos/x/pulls',                   // pulls router
    '/repos/x/workflows',               // actions router
    '/repos/x/timeline',                // postal router
    '/repos/x/identities'               // postal router
  ];

  for (const ep of endpoints) {
    // SIN token -> 401
    const noAuth = await req('GET', ep);
    const ok401 = noAuth.status === 401;
    console.log(`${ok401 ? 'OK' : 'FAIL'} SIN token  GET ${ep} -> ${noAuth.status} (esperado 401)`);
    if (!ok401) failures++;

    // CON token dev -> 200 (o 400/404 de dominio, pero NO 401)
    const withAuth = await req('GET', ep, { Authorization: `Bearer ${TOKEN}` });
    const ok200 = withAuth.status !== 401;
    console.log(`${ok200 ? 'OK' : 'FAIL'} CON token  GET ${ep} -> ${withAuth.status} (esperado != 401)`);
    if (!ok200) failures++;
  }

  server.close();
  if (failures > 0) {
    console.error(`\n✗ ${failures} comprobaciones fallaron`);
    process.exit(1);
  }
  console.log('\n✓ Hardening verificado: SIN token -> 401, CON token -> != 401 en los 5 routers');
  process.exit(0);
}

main().catch((e) => { console.error('verify FAIL:', e.message); process.exit(1); });