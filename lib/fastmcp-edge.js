// fastmcp-edge.js — Port ESM, edge-native, del servidor FastMCP a Cloudflare Workers.
//
// Reutiliza el nucleo JSON-RPC 2.0 de lib/fastmcp.js (transport-agnostico) pero:
//   - SIN dependencias de Node (readline / process / fs) -> importable en Workers.
//   - Transport "Streamable HTTP" STATELESS: un unico POST a /mcp.
//     No requiere Durable Object ni conexion persistente -> solo producto Workers,
//     100% dentro de los limites de una cuenta temporal de Cloudflare.
//   - Los handlers reciben un segundo argumento `context` ({ env, ctx, db, stores })
//     para poder envolver el data layer del Worker (DocStore/VectorStore sobre KV).
//   - Controles opcionales de seguridad/coste (auth, rate-limit, tope diario, kill
//     switch) configurables por env vars/bindings. TODOS OFF por defecto: sin esas
//     env vars el comportamiento es idéntico (MCP público sin auth). Ver _guard().

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, Accept, Authorization',
};

// Comparación en tiempo (casi) constante del token: no cortocircuita en el primer
// byte distinto, evitando filtrar la longitud del match por timing.
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export class FastMCPEdge {
    constructor(name, options = {}) {
        this.name = name || "FastMCP-Edge";
        this.version = options.version || "1.0.0";
        this.tools = new Map();
        this.resources = new Map();
        this.prompts = new Map();
    }

    tool(name, description, inputSchema, handler) {
        this.tools.set(name, { name, description, inputSchema, handler });
        return this;
    }

    resource(uri, name, description, mimeType, handler) {
        this.resources.set(uri, { uri, name, description, mimeType, handler });
        return this;
    }

    prompt(name, description, args, handler) {
        this.prompts.set(name, { name, description, arguments: args, handler });
        return this;
    }

    // Nucleo JSON-RPC 2.0 (identico en semantica a lib/fastmcp.js::_handleMessage).
    // `context` se inyecta a los handlers como segundo argumento.
    async _handleMessage(req, context) {
        const { id, method, params = {} } = req;
        const isNotification = id === undefined;

        try {
            let result = null;
            switch (method) {
                case 'initialize':
                    result = {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {}, resources: {}, prompts: {} },
                        serverInfo: { name: this.name, version: this.version },
                    };
                    break;

                case 'notifications/initialized':
                    return null;

                case 'tools/list':
                    result = {
                        tools: Array.from(this.tools.values()).map(t => ({
                            name: t.name, description: t.description, inputSchema: t.inputSchema,
                        })),
                    };
                    break;

                case 'tools/call': {
                    const tool = this.tools.get(params.name);
                    if (!tool) throw new Error(`Herramienta no encontrada: ${params.name}`);
                    const out = await tool.handler(params.arguments || {}, context);
                    result = {
                        content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }],
                        isError: false,
                    };
                    break;
                }

                case 'resources/list':
                    result = {
                        resources: Array.from(this.resources.values()).map(r => ({
                            uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType,
                        })),
                    };
                    break;

                case 'resources/read': {
                    const res = this.resources.get(params.uri);
                    if (!res) throw new Error(`Recurso no encontrado: ${params.uri}`);
                    const out = await res.handler(params, context);
                    result = {
                        contents: [{ uri: res.uri, mimeType: res.mimeType, text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }],
                    };
                    break;
                }

                case 'prompts/list':
                    result = {
                        prompts: Array.from(this.prompts.values()).map(p => ({
                            name: p.name, description: p.description, arguments: p.arguments || [],
                        })),
                    };
                    break;

                case 'prompts/get': {
                    const prompt = this.prompts.get(params.name);
                    if (!prompt) throw new Error(`Prompt no encontrado: ${params.name}`);
                    const msg = await prompt.handler(params.arguments || {}, context);
                    result = {
                        description: prompt.description,
                        messages: [{ role: 'user', content: { type: 'text', text: msg } }],
                    };
                    break;
                }

                default:
                    throw new Error(`Metodo JSON-RPC no soportado: ${method}`);
            }

            if (isNotification) return null;
            return { jsonrpc: '2.0', id, result };
        } catch (err) {
            if (isNotification) return null;
            return { jsonrpc: '2.0', id, error: { code: -32603, message: err.message || 'Internal MCP Server Error' } };
        }
    }

    // Transport Streamable HTTP (stateless). Devuelve un Web `Response`.
    // - GET  -> ping informativo.
    // - POST con id  -> responde el JSON-RPC (framing SSE si el cliente acepta text/event-stream, si no JSON).
    // - POST notificacion (sin id) -> 202 Accepted vacio.
    async handleStreamableHTTP(request, context) {
        const cors = CORS_HEADERS;

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (request.method === 'GET') {
            return new Response(`${this.name} v${this.version} — MCP Streamable HTTP. POST JSON-RPC aqui.`,
                { status: 200, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
        }
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors });

        // Controles opcionales (auth / rate-limit / tope / kill switch). Si bloquea, corta aqui.
        const blocked = await this._guard(request, context && context.env);
        if (blocked) return blocked;

        let payload;
        try { payload = await request.json(); }
        catch { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: cors }); }

        const response = await this._handleMessage(payload, context);
        if (!response) return new Response(null, { status: 202, headers: cors }); // notificacion

        const accept = request.headers.get('accept') || '';
        if (accept.includes('text/event-stream')) {
            const body = `event: message\ndata: ${JSON.stringify(response)}\n\n`;
            return new Response(body, { status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
        }
        return Response.json(response, { status: 200, headers: cors });
    }

    // Respuesta de bloqueo (error de transporte, antes del JSON-RPC).
    _deny(status, message) {
        return Response.json(
            { jsonrpc: '2.0', id: null, error: { code: -32000, message } },
            { status, headers: CORS_HEADERS }
        );
    }

    // Controles de seguridad/coste. TODOS opcionales y OFF por defecto: si no defines
    // las env vars/bindings, devuelve null (pasa) y el MCP se comporta como hasta ahora.
    //   env.MCP_DISABLED === "1"                 -> kill switch (503)
    //   env.MCP_KV  clave "mcp:disabled" === "1" -> kill switch instantaneo sin redeploy (503)
    //   env.MCP_AUTH_TOKEN                        -> exige Authorization: Bearer <token> (401)
    //   env.MCP_RATE_LIMITER (binding nativo)     -> rate limit por cliente (429)
    //   env.MCP_KV + env.MCP_DAILY_CAP            -> tope diario de requests, autocap de coste (429)
    async _guard(request, env) {
        env = env || {};

        // 1) Kill switch (env estatico)
        if (env.MCP_DISABLED === '1' || env.MCP_DISABLED === true) {
            return this._deny(503, 'MCP deshabilitado');
        }
        // 1b) Kill switch instantaneo via KV (sin redeploy)
        if (env.MCP_KV && typeof env.MCP_KV.get === 'function') {
            const off = await env.MCP_KV.get('mcp:disabled');
            if (off === '1') return this._deny(503, 'MCP deshabilitado');
        }

        // 2) Autenticacion Bearer
        if (env.MCP_AUTH_TOKEN) {
            const h = request.headers.get('authorization') || '';
            const token = h.startsWith('Bearer ') ? h.slice(7) : '';
            if (!safeEqual(token, env.MCP_AUTH_TOKEN)) {
                return this._deny(401, 'No autorizado');
            }
        }

        // Clave de cliente para los limites: el token si lo hay, si no la IP del edge.
        const clientKey = request.headers.get('authorization')
            || request.headers.get('cf-connecting-ip') || 'anon';

        // 3) Rate limit (binding nativo de Workers Rate Limiting)
        if (env.MCP_RATE_LIMITER && typeof env.MCP_RATE_LIMITER.limit === 'function') {
            const { success } = await env.MCP_RATE_LIMITER.limit({ key: clientKey });
            if (!success) return this._deny(429, 'Demasiadas solicitudes');
        }

        // 4) Tope diario sobre KV (autocap de coste). KV es eventual y el incremento no es
        //    atomico: suficiente como tope de coste aproximado, no como cuota exacta.
        if (env.MCP_KV && typeof env.MCP_KV.get === 'function' && env.MCP_DAILY_CAP) {
            const cap = parseInt(env.MCP_DAILY_CAP, 10);
            if (cap > 0) {
                const day = new Date().toISOString().slice(0, 10);
                const key = `mcp:count:${day}`;
                const cur = parseInt((await env.MCP_KV.get(key)) || '0', 10);
                if (cur >= cap) return this._deny(429, 'Tope diario alcanzado');
                await env.MCP_KV.put(key, String(cur + 1), { expirationTtl: 172800 });
            }
        }

        return null;
    }
}
