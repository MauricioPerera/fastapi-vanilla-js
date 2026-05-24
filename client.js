const { spawn } = require('child_process');
const path = require('path');

async function runClient() {
    console.log(`\n\x1b[1m\x1b[36m🚀 INICIANDO CLIENTE MCP DE PRUEBAS VANILLA JS (0 DEPENDENCIAS) 🚀\x1b[0m`);
    console.log(`====================================================================`);
    
    // Levantar el servidor mcp.js local como un subproceso stdio
    const serverPath = path.join(__dirname, 'mcp.js');
    const server = spawn('node', [serverPath]);
    
    // Capturar y mostrar la telemetría de stderr del servidor en la consola del cliente
    server.stderr.on('data', (data) => {
        const telemetry = data.toString().trim();
        telemetry.split('\n').forEach(line => {
            console.log(`  \x1b[90m[Server Telemetry]\x1b[0m ${line}`);
        });
    });
    
    let currentResolver = null;
    
    // Escuchar el canal stdout del servidor (donde se transmiten las tramas JSON-RPC 2.0)
    server.stdout.on('data', (data) => {
        try {
            const line = data.toString().trim();
            if (!line) return;
            
            // Procesar la primera línea (protocolo stdio asume delimitación por saltos de línea)
            const firstLine = line.split('\n')[0];
            const response = JSON.parse(firstLine);
            
            if (currentResolver) {
                currentResolver(response);
            }
        } catch (err) {
            console.error(`  \x1b[31m[Client Error] Error procesando trama del servidor: ${err.message}\x1b[0m`);
        }
    });
    
    // Auxiliar para enviar transacciones JSON-RPC asíncronas
    const sendRequest = (method, params = {}) => {
        return new Promise((resolve) => {
            const id = Math.floor(Math.random() * 100000);
            const request = {
                jsonrpc: "2.0",
                id,
                method,
                params
            };
            
            currentResolver = (res) => {
                if (res.id === id) {
                    resolve(res);
                }
            };
            
            console.log(`\n\x1b[34m[Client ➡ Server] Solicitud: "${method}" (ID: ${id})\x1b[0m`);
            server.stdin.write(JSON.stringify(request) + '\n');
        });
    };
    
    try {
        // --- 1. NEGOCIACIÓN DE INICIALIZACIÓN (Handshake) ---
        const initRes = await sendRequest('initialize', {
            protocolVersion: "2024-11-05",
            clientInfo: {
                name: "AntigravityTestClient",
                version: "2.0.0"
            }
        });
        console.log(`\x1b[32m[Server ➡ Client] ¡Conexión Establecida! Servidor: ${initRes.result.serverInfo.name} v${initRes.result.serverInfo.version}\x1b[0m`);
        
        // Notificación de inicializado completado (no requiere respuesta)
        console.log(`\x1b[34m[Client ➡ Server] Enviando notificación 'notifications/initialized'...\x1b[0m`);
        server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + '\n');
        
        // Esperar un breve instante para sincronización de streams
        await new Promise(r => setTimeout(r, 200));
        
        // --- 2. LISTAR HERRAMIENTAS ---
        const toolsRes = await sendRequest('tools/list');
        const toolsList = toolsRes.result.tools.map(t => t.name);
        console.log(`\x1b[32m[Server ➡ Client] Herramientas Disponibles:\x1b[0m`, toolsList);
        
        // --- 3. INVOCAR HERRAMIENTA obtener_metricas ---
        const callRes = await sendRequest('tools/call', {
            name: "obtener_metricas",
            arguments: {}
        });
        console.log(`\x1b[32m[Server ➡ Client] Resultado del Tool "obtener_metricas":\x1b[0m`);
        console.log(callRes.result.content[0].text);
        
        // --- 4. LEER RECURSO sistema://estado ---
        const readRes = await sendRequest('resources/read', {
            uri: "sistema://estado"
        });
        console.log(`\x1b[32m[Server ➡ Client] Contenido del Recurso "sistema://estado":\x1b[0m`);
        console.log(readRes.result.contents[0].text);
        
    } catch (error) {
        console.error(`\x1b[31m[Client Error] Error durante la transacción: ${error.message}\x1b[0m`);
    } finally {
        // Apagado del subproceso servidor
        console.log(`\n\x1b[36m🔌 Cerrando conexión y apagando subproceso mcp.js...\x1b[0m`);
        server.kill();
        console.log(`\x1b[32m✔ Cliente de prueba cerrado de forma limpia.\x1b[0m\n`);
    }
}

runClient();
