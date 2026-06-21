// Suite de los controles de seguridad/coste del MCP edge (lib/fastmcp-edge.js::_guard).
// Verifica que todo está OFF por defecto y que cada control bloquea cuando se configura.
const test = require('node:test');
const assert = require('node:assert');

// Mock mínimo de KV de Cloudflare (en memoria).
function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        async get(k) { return store.has(k) ? store.get(k) : null; },
        async put(k, v) { store.set(k, String(v)); },
        _store: store,
    };
}

function postReq(headers = {}) {
    return new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    });
}

test('Controles del MCP edge (_guard)', async (t) => {
    const { FastMCPEdge } = await import('./lib/fastmcp-edge.js');

    function mcp() {
        const m = new FastMCPEdge('test', { version: '1.0.0' });
        m.tool('ping', 'p', { type: 'object', properties: {} }, () => 'pong');
        return m;
    }

    await t.test('OFF por defecto: sin env vars, pasa (200)', async () => {
        const res = await mcp().handleStreamableHTTP(postReq(), { env: {} });
        assert.strictEqual(res.status, 200);
    });

    await t.test('Kill switch por env (MCP_DISABLED=1) -> 503', async () => {
        const res = await mcp().handleStreamableHTTP(postReq(), { env: { MCP_DISABLED: '1' } });
        assert.strictEqual(res.status, 503);
    });

    await t.test('Kill switch por KV (mcp:disabled=1) -> 503', async () => {
        const env = { MCP_KV: makeKV({ 'mcp:disabled': '1' }) };
        const res = await mcp().handleStreamableHTTP(postReq(), { env });
        assert.strictEqual(res.status, 503);
    });

    await t.test('Auth: token requerido y ausente -> 401', async () => {
        const res = await mcp().handleStreamableHTTP(postReq(), { env: { MCP_AUTH_TOKEN: 's3cr3t' } });
        assert.strictEqual(res.status, 401);
    });

    await t.test('Auth: token incorrecto -> 401', async () => {
        const req = postReq({ Authorization: 'Bearer malo' });
        const res = await mcp().handleStreamableHTTP(req, { env: { MCP_AUTH_TOKEN: 's3cr3t' } });
        assert.strictEqual(res.status, 401);
    });

    await t.test('Auth: token correcto -> 200', async () => {
        const req = postReq({ Authorization: 'Bearer s3cr3t' });
        const res = await mcp().handleStreamableHTTP(req, { env: { MCP_AUTH_TOKEN: 's3cr3t' } });
        assert.strictEqual(res.status, 200);
    });

    await t.test('Rate limit: binding niega -> 429', async () => {
        const env = { MCP_RATE_LIMITER: { limit: async () => ({ success: false }) } };
        const res = await mcp().handleStreamableHTTP(postReq(), { env });
        assert.strictEqual(res.status, 429);
    });

    await t.test('Rate limit: binding permite -> 200', async () => {
        const env = { MCP_RATE_LIMITER: { limit: async () => ({ success: true }) } };
        const res = await mcp().handleStreamableHTTP(postReq(), { env });
        assert.strictEqual(res.status, 200);
    });

    await t.test('Tope diario: bajo el cap pasa e incrementa el contador', async () => {
        const kv = makeKV();
        const env = { MCP_KV: kv, MCP_DAILY_CAP: '2' };
        const r1 = await mcp().handleStreamableHTTP(postReq(), { env });
        assert.strictEqual(r1.status, 200);
        const day = new Date().toISOString().slice(0, 10);
        assert.strictEqual(await kv.get(`mcp:count:${day}`), '1');
    });

    await t.test('Tope diario: alcanzado el cap -> 429', async () => {
        const day = new Date().toISOString().slice(0, 10);
        const kv = makeKV({ [`mcp:count:${day}`]: '2' });
        const env = { MCP_KV: kv, MCP_DAILY_CAP: '2' };
        const res = await mcp().handleStreamableHTTP(postReq(), { env });
        assert.strictEqual(res.status, 429);
    });

    await t.test('Auth I/O-independiente: token inválido NO toca KV (401 sin leer KV)', async () => {
        let kvTouched = false;
        const kv = { get: async () => { kvTouched = true; return null; }, put: async () => { kvTouched = true; } };
        const env = { MCP_AUTH_TOKEN: 'tok', MCP_KV: kv, MCP_DAILY_CAP: '100' };
        const res = await mcp().handleStreamableHTTP(postReq({ Authorization: 'Bearer malo' }), { env });
        assert.strictEqual(res.status, 401);
        assert.strictEqual(kvTouched, false, 'la auth debe rechazar antes de leer KV');
    });

    await t.test('Fail-open: si KV lanza, el guard no tumba el MCP (200)', async () => {
        const kv = { get: async () => { throw new Error('KV caído'); }, put: async () => {} };
        const env = { MCP_KV: kv, MCP_DAILY_CAP: '100' };
        const res = await mcp().handleStreamableHTTP(postReq(), { env });
        assert.strictEqual(res.status, 200);
    });

    await t.test('Combinado: auth OK + rate-limit OK + bajo cap -> 200', async () => {
        const env = {
            MCP_AUTH_TOKEN: 'tok',
            MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
            MCP_KV: makeKV(),
            MCP_DAILY_CAP: '100',
        };
        const req = postReq({ Authorization: 'Bearer tok' });
        const res = await mcp().handleStreamableHTTP(req, { env });
        assert.strictEqual(res.status, 200);
    });
});
