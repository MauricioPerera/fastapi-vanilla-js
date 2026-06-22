// Verificacion end-to-end de la capa POSTAL (memoria de proyecto / interaccion entre agentes).
// Flujo: crear issue -> evento en log -> leer timeline -> projector reconstruye estado ->
//        cerrar/comentar issue emite eventos -> agente postea interaccion -> aparece en historial.
// Self-contained: spawnea el server en un puerto, corre el flujo y lo mata.
const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');

const PORT = process.env.E2E_PORT || 8012;
const BASE = `http://localhost:${PORT}`;
const REPO = 'e2e-postal-' + Date.now().toString(36);

function req(method, pathStr, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + pathStr, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
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

async function main() {
  const server = spawn(process.execPath, ['index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit'
  });
  try {
    await waitForServer();
    console.log(`[e2e-postal] server listo en ${BASE}`);

    // 1. Crear repo
    let r = await req('POST', '/repos', { name: REPO });
    assert.strictEqual(r.status, 200, 'crear repo');
    console.log('[e2e-postal] repo creado:', REPO);

    // 2. Crear issue -> debe emitir evento issue.created en el log
    r = await req('POST', `/repos/${REPO}/issues`, { title: 'Bug Postal', body: 'describo el bug', agent: 'agent-alice' });
    assert.strictEqual(r.status, 200, 'crear issue');
    const issueNumber = r.body.issue.number;
    assert.strictEqual(issueNumber, 1, 'primer issue #1');
    console.log('[e2e-postal] issue creado:', issueNumber);

    // fire-and-forget: esperar a que el evento se persista
    let sawCreated = false;
    for (let i = 0; i < 20; i++) {
      const tl = await req('GET', `/repos/${REPO}/timeline`);
      if (tl.body.timeline && tl.body.timeline.some((t) => t.kind === 'issue.created')) { sawCreated = true; break; }
      await new Promise((res) => setTimeout(res, 150));
    }
    assert.ok(sawCreated, 'timeline debe contener issue.created');
    console.log('[e2e-postal] timeline contiene issue.created OK');

    // 3. Projector reconstruye estado: issue #1 en state.issues
    r = await req('GET', `/repos/${REPO}/state`);
    assert.ok(r.body.state.issues['1'], 'estado proyectado tiene issue #1');
    assert.strictEqual(r.body.state.issues['1'].state, 'open', 'issue abierto en estado proyectado');
    assert.strictEqual(r.body.state.counts['issue.created'], 1, 'count issue.created=1');
    console.log('[e2e-postal] projector reconstruye estado OK -> issue #1 open');

    // 4. Comentar issue -> emite issue.commented
    r = await req('POST', `/repos/${REPO}/issues/1/comments`, { author: 'agent-bob', body: 'lo reviso' });
    assert.strictEqual(r.status, 200, 'comentar issue');
    // 5. Cerrar issue -> emite issue.state_changed
    r = await req('POST', `/repos/${REPO}/issues/1/state`, { state: 'closed', agent: 'agent-alice' });
    assert.strictEqual(r.status, 200, 'cerrar issue');
    // esperar a que ambos eventos persistan
    for (let i = 0; i < 20; i++) {
      const st = await req('GET', `/repos/${REPO}/state`);
      if (st.body.state.issues['1'] && st.body.state.issues['1'].state === 'closed' && st.body.state.issues['1'].comments >= 1) break;
      await new Promise((res) => setTimeout(res, 150));
    }
    r = await req('GET', `/repos/${REPO}/state`);
    assert.strictEqual(r.body.state.issues['1'].state, 'closed', 'issue cerrado tras replay');
    assert.ok(r.body.state.issues['1'].comments >= 1, 'comentario contado en estado');
    console.log('[e2e-postal] comentar + cerrar emitieron eventos -> estado closed con comentario OK');

    // 6. Agente postea una interaccion dirigida al proyecto (agente fresco -> seq 0)
    r = await req('POST', `/repos/${REPO}/events`, {
      kind: 'agent.message', agentId: 'agent-carol',
      payload: { text: 'Reviso el issue #1 tras reproducir el bug' }, to: ['agent-alice']
    });
    assert.strictEqual(r.status, 200, 'postar evento de agente');
    assert.ok(r.body.event && r.body.event.id, 'evento tiene id');
    assert.strictEqual(r.body.event.seq, 0, 'primer evento de agent-carol seq 0');
    assert.strictEqual(r.body.event.prev, null, 'primer evento prev null');
    console.log('[e2e-postal] agente posteo interaccion OK -> seq', r.body.event.seq);

    // 7. La interaccion aparece en el historial (timeline) y state.messages
    r = await req('GET', `/repos/${REPO}/timeline`);
    const msgEntry = r.body.timeline.find((t) => t.kind === 'agent.message');
    assert.ok(msgEntry, 'timeline contiene el mensaje del agente');
    assert.ok(msgEntry.summary.indexOf('Reviso el issue') >= 0, 'summary del mensaje legible');
    r = await req('GET', `/repos/${REPO}/state`);
    assert.ok(r.body.state.messages.some((m) => m.from === 'agent-carol' && m.to.includes('agent-alice')), 'state.messages tiene la interaccion');
    assert.strictEqual(r.body.state.counts['agent.message'], 1, 'count agent.message=1');
    console.log('[e2e-postal] interaccion aparece en historial y estado OK');

    // 8. Verificacion de cadena: total/verified coinciden (sin eventos rotos)
    r = await req('GET', `/repos/${REPO}/timeline`);
    assert.strictEqual(r.body.failures.length, 0, 'sin fallos de cadena');
    assert.ok(r.body.verified >= 4, 'al menos 4 eventos verificados (created, commented, state_changed, message)');
    console.log('[e2e-postal] cadena verificada: total', r.body.total, 'verified', r.body.verified, 'failures', r.body.failures.length);

    // Limpieza
    r = await req('DELETE', `/repos/${REPO}`);
    assert.strictEqual(r.status, 200, 'borrar repo');
    console.log('[e2e-postal] repo borrado, TODO VERDE ✓');
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((e) => { console.error('[e2e-postal] FAIL:', e.message); process.exit(1); });