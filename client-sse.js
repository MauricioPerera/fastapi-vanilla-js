const http = require('http');
const path = require('path');

// Forzar puerto de pruebas aislado para evitar colisiones con el servidor de producción
process.env.PORT = '8999';
const app = require('./index');

async function runSseClient() {
    console.log(`\n\x1b[1m\x1b[36m🚀 INICIANDO CLIENTE MCP SOBRE RED HTTP/SSE (0 DEPENDENCIAS) 🚀\x1b[0m`);
    console.log(`======================================================================`);

    const sseUrl = 'http://localhost:8999/sse';
    let activeClientUrl = '';
    let currentResolver = null;

    // 1. Abrir canal SSE (Server-Sent Events) usando http.get nativo de Node.js
    const sseRequest = http.get(sseUrl, (res) => {
        let buffer = '';

        res.on('data', (chunk) => {
            buffer += chunk.toString();
            
            // Los bloques de Server-Sent Events se delimitan estrictamente por dobles saltos de línea (\n\n)
            const parts = buffer.split('\n\n');
            buffer = parts.pop(); // Mantener el fragmento incompleto en el búfer

            for (const part of parts) {
                const lines = part.split('\n');
                let event = '';
                let data = '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        event = line.substring(7).trim();
                    } else if (line.startsWith('data: ')) {
                        data = line.substring(6).trim();
                    }
                }

                // Detectar el establecimiento del endpoint activo de mensajería POST
                if (event === 'endpoint') {
                    activeClientUrl = `http://localhost:8999${data}`;
                    console.log(`\x1b[32m[Client ➡ Server] Canal SSE Abierto. Endpoint de red asignado: ${activeClientUrl}\x1b[0m`);
                    
                    // Disparar secuencialmente las peticiones sobre red
                    triggerTransactionSequence();
                } 
                // Detectar mensajes de datos entrantes (JSON-RPC) del servidor
                else if (event === 'message' && data) {
                    try {
                        const message = JSON.parse(data);
                        if (currentResolver) {
                            currentResolver(message);
                        }
                    } catch (e) {
                        console.error(`  \x1b[31m[Client Error] Fallo al procesar mensaje JSON de red: ${e.message}\x1b[0m`);
                    }
                }
            }
        });
    });

    sseRequest.on('error', (err) => {
        console.error(`\x1b[31m[Client Error] Error de comunicación en el canal SSE: ${err.message}\x1b[0m`);
    });

    // Auxiliar para enviar peticiones HTTP POST estructuradas
    const sendPostRequest = (payload) => {
        return new Promise((resolve) => {
            currentResolver = (res) => {
                if (res.id === payload.id) {
                    resolve(res);
                }
            };

            console.log(`\n\x1b[34m[Client ➡ Server] POST (JSON-RPC) Método: "${payload.method}" (ID: ${payload.id})\x1b[0m`);

            const postUrlObj = new URL(activeClientUrl);
            const postReq = http.request({
                hostname: postUrlObj.hostname,
                port: postUrlObj.port,
                path: postUrlObj.pathname + postUrlObj.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            }, (res) => {
                // Consumir el stream de respuesta HTTP para liberar sockets
                res.resume();
            });

            postReq.on('error', (err) => {
                console.error(`  \x1b[31m[Client Error] Fallo de envío en petición POST: ${err.message}\x1b[0m`);
            });

            postReq.write(JSON.stringify(payload));
            postReq.end();
        });
    };

    // Secuencia interactiva de transacciones sobre la red HTTP/SSE
    async function triggerTransactionSequence() {
        try {
            // --- 1. NEGOCIACIÓN INICIAL (Handshake) ---
            const initRes = await sendPostRequest({
                jsonrpc: "2.0",
                id: 55555,
                method: "initialize",
                params: {
                    protocolVersion: "2024-11-05",
                    clientInfo: {
                        name: "AntigravitySseClient",
                        version: "2.0.0"
                    }
                }
            });
            console.log(`\x1b[32m[Server ➡ Client] ¡Apretón de Manos SSE Exitoso! Servidor: ${initRes.result.serverInfo.name} v${initRes.result.serverInfo.version}\x1b[0m`);

            // Enviar notificación de inicialización completada (sin respuesta)
            console.log(`\x1b[34m[Client ➡ Server] Enviando notificación 'notifications/initialized'...\x1b[0m`);
            const postUrlObj = new URL(activeClientUrl);
            const postReq = http.request({
                hostname: postUrlObj.hostname,
                port: postUrlObj.port,
                path: postUrlObj.pathname + postUrlObj.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            postReq.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
            postReq.end();

            // Esperar sincronización de eventos
            await new Promise(r => setTimeout(r, 200));

            // --- 2. INVOCAR HERRAMIENTA obtener_metricas ---
            const callRes = await sendPostRequest({
                jsonrpc: "2.0",
                id: 66666,
                method: "tools/call",
                params: {
                    name: "obtener_metricas",
                    arguments: {}
                }
            });
            console.log(`\x1b[32m[Server ➡ Client] Resultado del Tool SSE "obtener_metricas":\x1b[0m`);
            console.log(callRes.result.content[0].text);

            // --- 3. LEER RECURSO sistema://estado ---
            const readRes = await sendPostRequest({
                jsonrpc: "2.0",
                id: 77777,
                method: "resources/read",
                params: {
                    uri: "sistema://estado"
                }
            });
            console.log(`\x1b[32m[Server ➡ Client] Contenido del Recurso SSE "sistema://estado":\x1b[0m`);
            console.log(readRes.result.contents[0].text);

            // --- 4. INVOCAR HERRAMIENTA guardar_log ---
            const logRes = await sendPostRequest({
                jsonrpc: "2.0",
                id: 88888,
                method: "tools/call",
                params: {
                    name: "guardar_log",
                    arguments: {
                        evento: "SSE_CLIENT_TEST",
                        detalles: "Ejecución de test de red interactivo sobre HTTP/SSE"
                    }
                }
            });
            console.log(`\x1b[32m[Server ➡ Client] Resultado del Tool SSE "guardar_log":\x1b[0m`);
            console.log(logRes.result.content[0].text);

            // --- 5. OBTENER PROMPT explicar_mcp ---
            const promptRes = await sendPostRequest({
                jsonrpc: "2.0",
                id: 99999,
                method: "prompts/get",
                params: {
                    name: "explicar_mcp",
                    arguments: {}
                }
            });
            console.log(`\x1b[32m[Server ➡ Client] Contenido del Prompt SSE "explicar_mcp":\x1b[0m`);
            console.log(promptRes.result.messages[0].content.text);

        } catch (e) {
            console.error(`\x1b[31m[Client Error] Fallo crítico durante la secuencia de red: ${e.message}\x1b[0m`);
        } finally {
            console.log(`\n\x1b[36m🔌 Cerrando canales de red y apagando servidor FastAPI/SSE...\x1b[0m`);
            sseRequest.destroy(); // Cerrar el canal de eventos
            if (app.server) {
                app.server.close(() => {
                    console.log(`\x1b[32m✔ Servidor de red detenido. Sesión finalizada limpiamente.\x1b[0m\n`);
                    process.exit(0);
                });
            }
        }
    }
}

runSseClient();
