// Suite del transporte SSE de FastMCP (setupSSE: GET /sse + POST /message),
// la parte de fastmcp.js que la suite stdio no cubría. Abre el stream SSE real,
// negocia el clientId, envía un mensaje JSON-RPC y lee la respuesta por el stream.
const test = require('node:test');
const assert = require('node:assert');
const { FastAPI } = require('./lib/fastapi');
const { FastMCP } = require('./lib/fastmcp');
const { registerSystemFeatures } = require('./lib/mcp-features');

const PORT = 8995;
const BASE = `http://localhost:${PORT}`;
let server;

test.before(async () => {
  const app = new FastAPI({ title: 'sse-test' });
  const mcp = new FastMCP('sse-test', { version: '0.0.0' });
  registerSystemFeatures(mcp);
  mcp.setupSSE(app);
  server = app.listen(PORT);
  await new Promise(resolve => { server.listening ? resolve() : server.once('listening', resolve); });
});

test.after(() => { if (server) server.close(); });

// Lee del stream SSE hasta que `buffer` matchee `regex` (con timeout para no colgar CI).
async function readUntil(reader, decoder, state, regex, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const m = state.buffer.match(regex);
    if (m) return m;
    if (Date.now() > deadline) throw new Error(`Timeout esperando SSE: ${regex}`);
    const chunk = await Promise.race([
      reader.read(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('read timeout')), deadline - Date.now())),
    ]);
    if (chunk.done) throw new Error('stream SSE cerrado inesperadamente');
    state.buffer += decoder.decode(chunk.value, { stream: true });
  }
}

test('SSE: handshake (endpoint) + POST /message + respuesta por el stream', async () => {
  const ac = new AbortController();
  try {
    const sse = await fetch(`${BASE}/sse`, { signal: ac.signal });
    assert.strictEqual(sse.headers.get('content-type'), 'text/event-stream');
    const reader = sse.body.getReader();
    const decoder = new TextDecoder();
    const state = { buffer: '' };

    // 1. El servidor anuncia el endpoint con el clientId asignado.
    const ep = await readUntil(reader, decoder, state, /data: \/message\?client=(\S+)/);
    const clientId = ep[1];
    assert.ok(clientId);

    // 2. Enviamos un JSON-RPC por POST /message.
    const post = await fetch(`${BASE}/message?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.strictEqual(post.status, 200);
    assert.strictEqual((await post.json()).status, 'processed');

    // 3. La respuesta llega como evento `message` por el stream SSE abierto.
    const msgMatch = await readUntil(reader, decoder, state, /event: message\ndata: (.+)\n\n/);
    const response = JSON.parse(msgMatch[1]);
    assert.strictEqual(response.id, 1);
    assert.ok(Array.isArray(response.result.tools) && response.result.tools.length > 0);
  } finally {
    ac.abort();
  }
});

test('POST /message con client desconocido → 400', async () => {
  const res = await fetch(`${BASE}/message?client=noexiste`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} }),
  });
  assert.strictEqual(res.status, 400);
  assert.ok((await res.json()).error);
});
