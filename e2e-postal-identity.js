// Verificacion end-to-end de PROVENANCE ECDSA (iteracion 3).
// Flujo: crear identidad -> postear evento firmado -> verifyChains valida la firma
//        (timeline sin fallos) -> manipular el body del evento firmado en disco ->
//        bad-signature y queda excluido del estado -> evento de autor NO registrado
//        con sig presente -> unknown-author rechazado.
// Self-contained: spawnea el server en un puerto, corre el flujo y lo mata.
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const assert = require('assert');
const subtle = globalThis.crypto.subtle;

const PORT = process.env.E2E_PORT || 8013;
const BASE = `http://localhost:${PORT}`;
const REPO = 'e2e-postal-id-' + Date.now().toString(36);
const EVENTS_DIR = path.join(__dirname, '.data', 'events');

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

// Replica eventFilePath para localizar el archivo del evento en disco.
function eventPath(ev) {
  const d = new Date(ev.created_at);
  const p = (n) => String(n).padStart(2, '0');
  return path.join(EVENTS_DIR, REPO, String(d.getUTCFullYear()), p(d.getUTCMonth() + 1), p(d.getUTCDate()), ev.id + '.json');
}

async function main() {
  const server = spawn(process.execPath, ['index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit'
  });
  try {
    await waitForServer();
    console.log(`[e2e-id] server listo en ${BASE}`);

    // 0. Crear repo
    let r = await req('POST', '/repos', { name: REPO });
    assert.strictEqual(r.status, 200, 'crear repo');

    // 1. Crear identidad de agente -> devuelve agentId + publica + PRIVADA (una sola vez)
    r = await req('POST', `/repos/${REPO}/identities`, {});
    assert.strictEqual(r.status, 200, 'crear identidad');
    const agentId = r.body.agentId;
    const publicKeyJwk = r.body.publicKeyJwk;
    const privateKeyJwk = r.body.privateKeyJwk;
    assert.ok(agentId && agentId.length > 20, 'agentId derivado');
    assert.ok(publicKeyJwk && publicKeyJwk.kty === 'EC', 'publicKeyJwk EC');
    assert.ok(privateKeyJwk && privateKeyJwk.d, 'privateKeyJwk tiene componente privado d');
    assert.strictEqual(r.body.existed, false, 'primera vez existed=false');
    console.log('[e2e-id] identidad creada -> agentId:', agentId.slice(0, 12) + '...');

    // 2. Listar identidades -> la registrada aparece (solo publica)
    r = await req('GET', `/repos/${REPO}/identities`);
    assert.strictEqual(r.status, 200, 'listar identidades');
    assert.strictEqual(r.body.total, 1, 'una identidad registrada');
    assert.strictEqual(r.body.identities[0].agentId, agentId, 'agentId listado coincide');
    assert.ok(!r.body.identities[0].publicKeyJwk.d, 'la lista NO expone la privada');
    console.log('[e2e-id] identidad listada (solo publica) OK');

    // 3. Postear evento FIRMADO con la identidad registrada
    r = await req('POST', `/repos/${REPO}/events`, {
      kind: 'issue.created', agentId,
      payload: { number: 1, title: 'Bug firmado', state: 'open' },
      identity: { signPrivateJwk: privateKeyJwk }
    });
    assert.strictEqual(r.status, 200, 'postar evento firmado');
    const ev = r.body.event;
    assert.ok(ev.sig && typeof ev.sig === 'string' && ev.sig.length > 0, 'evento firmado (sig != null)');
    assert.strictEqual(ev.seq, 0, 'seq 0');
    console.log('[e2e-id] evento firmado posteado -> sig presente, seq', ev.seq);

    // 4. verifyChains valida la firma: timeline sin fallos, evento verificado
    for (let i = 0; i < 20; i++) {
      r = await req('GET', `/repos/${REPO}/timeline`);
      if (r.body.verified >= 1) break;
      await new Promise((res) => setTimeout(res, 150));
    }
    assert.strictEqual(r.body.failures.length, 0, 'sin fallos de firma/cadena');
    assert.ok(r.body.verified >= 1, 'evento firmado verificado');
    r = await req('GET', `/repos/${REPO}/state`);
    assert.ok(r.body.state.issues['1'], 'issue #1 proyectado (firma valida)');
    console.log('[e2e-id] verifyChains valido la firma OK -> verified', r.body.verified, 'failures', r.body.failures.length);

    // 5. Manipular el body del evento firmado en disco -> rompe la firma sin romper la cadena
    const file = eventPath(ev);
    assert.ok(fs.existsSync(file), 'archivo de evento existe: ' + file);
    const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
    tampered.body.title = 'MANIPULADO';
    fs.writeFileSync(file, JSON.stringify(tampered, null, 2), 'utf8');
    console.log('[e2e-id] body del evento manipulado en disco');

    r = await req('GET', `/repos/${REPO}/timeline`);
    const badSig = r.body.failures.find((f) => f.reasons && f.reasons.includes('bad-signature'));
    assert.ok(badSig, 'failure bad-signature reportado: ' + JSON.stringify(r.body.failures));
    assert.strictEqual(r.body.verified, 0, 'evento con firma rota excluido del estado proyectado');
    r = await req('GET', `/repos/${REPO}/state`);
    assert.ok(!r.body.state.issues['1'], 'issue #1 NO proyectado (firma invalida)');
    console.log('[e2e-id] bad-signature detectado y excluido OK -> failures', r.body.failures.length);

    // 6. Restaurar el body para dejar la cadena limpia y probar unknown-author
    fs.writeFileSync(file, JSON.stringify(ev, null, 2), 'utf8');

    // 7. Evento de autor NO registrado CON sig presente -> unknown-author rechazado.
    // Generamos un keypair fresco (no registrado) y postamos con ese agentId.
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const unregPriv = await subtle.exportKey('jwk', kp.privateKey);
    r = await req('POST', `/repos/${REPO}/events`, {
      kind: 'issue.created', agentId: 'agente-fantasma',
      payload: { number: 2, title: 'no estoy registrado', state: 'open' },
      identity: { signPrivateJwk: unregPriv }
    });
    assert.strictEqual(r.status, 200, 'postar evento de autor no registrado');
    assert.ok(r.body.event.sig, 'evento del fantasma tambien va firmado (sig presente)');
    for (let i = 0; i < 20; i++) {
      r = await req('GET', `/repos/${REPO}/timeline`);
      if (r.body.total >= 2) break;
      await new Promise((res) => setTimeout(res, 150));
    }
    const unk = r.body.failures.find((f) => f.reasons && f.reasons.includes('unknown-author'));
    assert.ok(unk, 'failure unknown-author reportado: ' + JSON.stringify(r.body.failures));
    r = await req('GET', `/repos/${REPO}/state`);
    assert.ok(!r.body.state.issues['2'], 'issue #2 del fantasma NO proyectado (autor no registrado)');
    console.log('[e2e-id] unknown-author rechazado y excluido OK');

    // Limpieza
    r = await req('DELETE', `/repos/${REPO}`);
    assert.strictEqual(r.status, 200, 'borrar repo');
    console.log('[e2e-id] TODO VERDE ✓');
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((e) => { console.error('[e2e-id] FAIL:', e.message); process.exit(1); });