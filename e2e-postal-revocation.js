// Verificacion end-to-end de ROTACION y REVOCACION de claves (Capa Postal).
// Flujo:
//   crear identidad (genesis g) -> evento firmado por g verifica (genesis activa)
//   -> rotar a clave nueva n (identity.rotated firmado por g)
//   -> evento firmado por n verifica (n activa); evento firmado por g (vieja) -> stale-key rechazado
//   -> revocar n (identity.revoked firmado por n, target=n)
//   -> evento firmado por n tras revocacion -> revoked-key rechazado
//   -> GET /keys devuelve el historial (g rotated, n revoked).
// Self-contained: spawnea el server en un puerto, corre el flujo y lo mata.
const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');
const subtle = globalThis.crypto.subtle;

const PORT = process.env.E2E_PORT || 8014;
const BASE = `http://localhost:${PORT}`;
const REPO = 'e2e-postal-revoc-' + Date.now().toString(36);

function req(method, pathStr, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + pathStr, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Authorization': 'Bearer super-secret-token' } : { 'Authorization': 'Bearer super-secret-token' }
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

function waitForServer() {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      http.get(BASE + '/', (res) => { res.resume(); resolve(); }).on('error', () => {
        if (++tries > 60) reject(new Error('server no arranca'));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function genKp() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    privateKeyJwk: await subtle.exportKey('jwk', kp.privateKey),
    publicKeyJwk: await subtle.exportKey('jwk', kp.publicKey)
  };
}

async function timelineHas(pred) {
  for (let i = 0; i < 30; i++) {
    const r = await req('GET', `/repos/${REPO}/timeline`);
    if (pred(r.body)) return r.body;
    await sleep(150);
  }
  const r = await req('GET', `/repos/${REPO}/timeline`);
  return r.body;
}

async function main() {
  const server = spawn(process.execPath, ['index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit'
  });
  try {
    await waitForServer();
    console.log(`[e2e-revoc] server listo en ${BASE}`);

    // 0. Crear repo
    let r = await req('POST', '/repos', { name: REPO });
    assert.strictEqual(r.status, 200, 'crear repo');

    // 1. Identidad genesis (g)
    r = await req('POST', `/repos/${REPO}/identities`, {});
    assert.strictEqual(r.status, 200, 'crear identidad genesis');
    const agentId = r.body.agentId;
    const privG = r.body.privateKeyJwk;
    assert.ok(agentId, 'agentId genesis');
    console.log('[e2e-revoc] genesis creada -> agentId:', agentId.slice(0, 12) + '...');

    // 2. Evento firmado por g (genesis activa) -> verifica
    r = await req('POST', `/repos/${REPO}/events`, {
      kind: 'issue.created', agentId,
      payload: { number: 1, title: 'genesis activa', state: 'open' },
      identity: { signPrivateJwk: privG }
    });
    assert.strictEqual(r.status, 200, 'postar evento genesis');
    let tl = await timelineHas((b) => b.verified >= 1);
    assert.strictEqual(tl.failures.length, 0, 'sin fallos con genesis activa: ' + JSON.stringify(tl.failures));
    r = await req('GET', `/repos/${REPO}/state`);
    assert.ok(r.body.state.issues['1'], 'issue #1 proyectado (genesis activa)');
    console.log('[e2e-revoc] evento de genesis verifica OK');

    // 3. Rotar a clave nueva n (identity.rotated firmado por g)
    const n = await genKp();
    r = await req('POST', `/repos/${REPO}/identities/${agentId}/rotate`, {
      newPublicJwk: n.publicKeyJwk,
      identity: { signPrivateJwk: privG }
    });
    assert.strictEqual(r.status, 200, 'rotar clave');
    assert.strictEqual(r.body.event.kind, 'identity.rotated', 'evento identity.rotated');
    console.log('[e2e-revoc] rotacion aplicada (g -> n)');

    // sleep para garantizar created_at estrictamente creciente entre rotacion y eventos posteriores
    await sleep(50);

    // 4. Evento firmado por n (nueva activa) -> verifica y proyecta
    r = await req('POST', `/repos/${REPO}/events`, {
      kind: 'issue.created', agentId,
      payload: { number: 2, title: 'clave nueva', state: 'open' },
      identity: { signPrivateJwk: n.privateKeyJwk }
    });
    assert.strictEqual(r.status, 200, 'postar evento con clave nueva');

    // 5. Evento firmado por g (vieja, ya rotada) -> stale-key rechazado
    r = await req('POST', `/repos/${REPO}/events`, {
      kind: 'issue.created', agentId,
      payload: { number: 3, title: 'clave vieja', state: 'open' },
      identity: { signPrivateJwk: privG }
    });
    assert.strictEqual(r.status, 200, 'postar evento con clave vieja');

    tl = await timelineHas((b) => b.failures.some((f) => f.reasons && f.reasons.includes('stale-key')));
    const stale = tl.failures.find((f) => f.reasons && f.reasons.includes('stale-key'));
    assert.ok(stale, 'stale-key reportado: ' + JSON.stringify(tl.failures));
    r = await req('GET', `/repos/${REPO}/state`);
    assert.ok(r.body.state.issues['2'], 'issue #2 (clave nueva) proyectado');
    assert.ok(!r.body.state.issues['3'], 'issue #3 (clave vieja) NO proyectado (stale-key)');
    console.log('[e2e-revoc] stale-key detectado y excluido OK');

    // 6. Revocar n (identity.revoked firmado por n, target=n)
    r = await req('POST', `/repos/${REPO}/identities/${agentId}/revoke`, {
      targetPublicJwk: n.publicKeyJwk,
      identity: { signPrivateJwk: n.privateKeyJwk }
    });
    assert.strictEqual(r.status, 200, 'revocar clave');
    assert.strictEqual(r.body.event.kind, 'identity.revoked', 'evento identity.revoked');
    console.log('[e2e-revoc] revocacion aplicada (n revocada)');

    await sleep(50);

    // 7. Evento firmado por n tras revocacion -> revoked-key rechazado
    r = await req('POST', `/repos/${REPO}/events`, {
      kind: 'issue.created', agentId,
      payload: { number: 4, title: 'clave revocada', state: 'open' },
      identity: { signPrivateJwk: n.privateKeyJwk }
    });
    assert.strictEqual(r.status, 200, 'postar evento con clave revocada');

    tl = await timelineHas((b) => b.failures.some((f) => f.reasons && f.reasons.includes('revoked-key')));
    const revoked = tl.failures.find((f) => f.reasons && f.reasons.includes('revoked-key'));
    assert.ok(revoked, 'revoked-key reportado: ' + JSON.stringify(tl.failures));
    r = await req('GET', `/repos/${REPO}/state`);
    assert.ok(!r.body.state.issues['4'], 'issue #4 (clave revocada) NO proyectado (revoked-key)');
    console.log('[e2e-revoc] revoked-key detectado y excluido OK');

    // 8. GET /keys -> historial: g rotated, n revoked
    r = await req('GET', `/repos/${REPO}/identities/${agentId}/keys`);
    assert.strictEqual(r.status, 200, 'GET keys');
    const keys = r.body.keys;
    assert.strictEqual(keys.length, 2, '2 claves en el historial: ' + JSON.stringify(keys));
    assert.strictEqual(keys[0].status, 'rotated', 'genesis rotated');
    assert.ok(keys[0].superseded_at, 'genesis con superseded_at');
    assert.strictEqual(keys[1].status, 'revoked', 'n revoked');
    assert.ok(keys[1].revoked_at, 'n con revoked_at');
    console.log('[e2e-revoc] historial de claves OK:', keys.map((k) => k.status).join(' -> '));

    // Limpieza
    r = await req('DELETE', `/repos/${REPO}`);
    assert.strictEqual(r.status, 200, 'borrar repo');
    console.log('[e2e-revoc] TODO VERDE ✓');
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((e) => { console.error('[e2e-revoc] FAIL:', e.message); process.exit(1); });