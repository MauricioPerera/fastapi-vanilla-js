const readline = require('readline');

class FastMCP {
    constructor(name, options = {}) {
        this.name = name || "FastMCP-Vanilla-Server";
        this.version = options.version || "1.0.0";
        this.tools = new Map();
        this.resources = new Map();
        this.prompts = new Map();
        
        // Manejador de excepciones por defecto
        this.defaultExceptionHandler = (method, err) => {
            return {
                code: -32603,
                message: err.message || "Internal MCP Server Error"
            };
        };
    }

    // Registra una herramienta ejecutable por el LLM
    tool(name, description, inputSchema, handler) {
        this.tools.set(name, { name, description, inputSchema, handler });
        this._log(`Herramienta registrada: [${name}]`);
    }

    // Registra un recurso consultable por el LLM (como URIs de bases de datos o variables)
    resource(uri, name, description, mimeType, handler) {
        this.resources.set(uri, { uri, name, description, mimeType, handler });
        this._log(`Recurso registrado: [${uri}]`);
    }

    // Registra una plantilla de prompts reutilizables
    prompt(name, description, args, handler) {
        this.prompts.set(name, { name, description, arguments: args, handler });
        this._log(`Prompt registrado: [${name}]`);
    }

    // Escribe logs de forma segura en stderr para evitar corromper stdout que es exclusivo de JSON-RPC
    _log(msg) {
        console.error(`[\x1b[35m${this.name}\x1b[0m] ${msg}`);
    }

    // Inicia el servidor e interactúa con process.stdin y process.stdout
    start() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

        rl.on('line', async (line) => {
            if (!line.trim()) return;
            try {
                const request = JSON.parse(line);
                if (request.jsonrpc !== '2.0') return;

                const response = await this._handleMessage(request);
                if (response) {
                    // La respuesta debe ir en una sola línea terminada en \n
                    process.stdout.write(JSON.stringify(response) + '\n');
                }
            } catch (err) {
                this._log(`Error procesando entrada línea JSON: ${err.message}`);
            }
        });

        this._log(`Servidor iniciado sobre transporte STDIO.`);
    }

    // Gestor de peticiones JSON-RPC 2.0
    async _handleMessage(req) {
        const { id, method, params } = req;
        const isNotification = id === undefined;

        try {
            let result = null;

            switch (method) {
                case 'initialize':
                    this._log(`Cliente inicializando conexión: ${params.clientInfo ? params.clientInfo.name : 'Unknown'} v${params.clientInfo ? params.clientInfo.version : '0.0'}`);
                    result = {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {},
                            resources: {},
                            prompts: {}
                        },
                        serverInfo: {
                            name: this.name,
                            version: this.version
                        }
                    };
                    break;

                case 'notifications/initialized':
                    this._log(`Cliente inicializado con éxito.`);
                    return null;

                case 'tools/list':
                    this._log(`Listando herramientas...`);
                    result = {
                        tools: Array.from(this.tools.values()).map(t => ({
                            name: t.name,
                            description: t.description,
                            inputSchema: t.inputSchema
                        }))
                    };
                    break;

                case 'tools/call':
                    this._log(`Ejecutando herramienta: [${params.name}]`);
                    const tool = this.tools.get(params.name);
                    if (!tool) throw new Error(`Herramienta no encontrada: ${params.name}`);

                    const toolOutput = await tool.handler(params.arguments || {});
                    result = {
                        content: [
                            {
                                type: 'text',
                                text: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput, null, 2)
                            }
                        ],
                        isError: false
                    };
                    break;

                case 'resources/list':
                    this._log(`Listando recursos...`);
                    result = {
                        resources: Array.from(this.resources.values()).map(r => ({
                            uri: r.uri,
                            name: r.name,
                            description: r.description,
                            mimeType: r.mimeType
                        }))
                    };
                    break;

                case 'resources/read':
                    this._log(`Leyendo recurso: [${params.uri}]`);
                    const res = this.resources.get(params.uri);
                    if (!res) throw new Error(`Recurso no encontrado: ${params.uri}`);

                    const resourceOutput = await res.handler(params);
                    result = {
                        contents: [
                            {
                                uri: res.uri,
                                mimeType: res.mimeType,
                                text: typeof resourceOutput === 'string' ? resourceOutput : JSON.stringify(resourceOutput, null, 2)
                            }
                        ]
                    };
                    break;

                case 'prompts/list':
                    this._log(`Listando plantillas de prompts...`);
                    result = {
                        prompts: Array.from(this.prompts.values()).map(p => ({
                            name: p.name,
                            description: p.description,
                            arguments: p.arguments || []
                        }))
                    };
                    break;

                case 'prompts/get':
                    this._log(`Obteniendo prompt: [${params.name}]`);
                    const prompt = this.prompts.get(params.name);
                    if (!prompt) throw new Error(`Prompt no encontrado: ${params.name}`);

                    const promptMsg = await prompt.handler(params.arguments || {});
                    result = {
                        description: prompt.description,
                        messages: [
                            {
                                role: 'user',
                                content: {
                                    type: 'text',
                                    text: promptMsg
                                }
                            }
                        ]
                    };
                    break;

                default:
                    throw new Error(`Método JSON-RPC no soportado: ${method}`);
            }

            if (isNotification) return null;

            return {
                jsonrpc: '2.0',
                id,
                result
            };
        } catch (err) {
            this._log(`Error procesando método [${method}]: ${err.message}`);
            if (isNotification) return null;

            const errObj = this.defaultExceptionHandler(method, err);
            return {
                jsonrpc: '2.0',
                id,
                error: errObj
            };
        }
    }

    // Verificador de auth para la superficie SSE. Reusa dependencies/auth.js
    // (getCurrentUser: mismo modelo de token que los routers REST — dev bypass
    // 'super-secret-token' / prod API_SECRET_TOKEN fail-secure). Es wiring de
    // adaptador, NO un verificador nuevo: delega en el verificador existente.
    //
    // Dónde va el token en SSE:
    //   1) Header Authorization: Bearer <token> (preferido; fetch/clients no-browser).
    //   2) Query param ?token=<bearer> como fallback SOLO para clientes EventSource
    //      de navegador, cuya API no permite setear headers custom. Si viene por
    //      query y no hay header, se inyecta en req.headers antes de verificar, de
    //      modo que getCurrentUser (que lee el header) funcione sin cambios.
    // Sin token válido -> getCurrentUser responde 401 y lanza; el guard devuelve
    // false y el handler NO abre el stream / NO procesa el mensaje.
    async _sseAuth(req, res) {
        if (!req.headers['authorization'] && req.query && req.query.token) {
            req.headers['authorization'] = 'Bearer ' + req.query.token;
        }
        try {
            const { getCurrentUser } = require('../dependencies/auth');
            await getCurrentUser(req, res);
            return true;
        } catch (e) {
            return false; // getCurrentUser ya respondió 401/403; no abrir el stream
        }
    }

    // Registra endpoints SSE (Server-Sent Events) sobre una instancia del microframework FastAPI
    setupSSE(app) {
        const activeClients = new Map();

        app.get('/sse', async (req, res) => {
            // Auth ANTES de abrir el stream: sin token válido -> 401, no se abre SSE.
            if (!(await this._sseAuth(req, res))) return;

            // Cabeceras recomendadas para streaming en caliente (SSE)
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });

            // Generar ID único para el cliente
            const clientId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
            activeClients.set(clientId, res);

            // Indicar de inmediato al cliente a qué URI debe enviar los mensajes POST
            res.write(`event: endpoint\ndata: /message?client=${clientId}\n\n`);
            this._log(`Cliente SSE conectado exitosamente. ID asignado: [${clientId}]`);

            req.on('close', () => {
                activeClients.delete(clientId);
                this._log(`Cliente SSE desconectado. Removiendo ID: [${clientId}]`);
            });
        });

        app.post('/message', async (req, res) => {
            // Auth ANTES de procesar el mensaje JSON-RPC: sin token válido -> 401.
            if (!(await this._sseAuth(req, res))) return;

            const clientId = req.query.client;
            const clientStream = activeClients.get(clientId);

            if (!clientStream) {
                return res.json({ error: "Client not found in active SSE registry" }, 400);
            }

            // req.body es el payload JSON-RPC pre-parseado
            const requestJsonRpc = req.body;
            const responseJsonRpc = await this._handleMessage(requestJsonRpc);

            if (responseJsonRpc) {
                // Escribir la respuesta formateada como evento de mensaje en el stream SSE abierto del cliente
                clientStream.write(`event: message\ndata: ${JSON.stringify(responseJsonRpc)}\n\n`);
            }

            return res.json({ status: "processed" });
        });
    }
}

module.exports = {
    FastMCP
};
