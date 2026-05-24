const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

test('FastMCP (Model Context Protocol) E2E Integration Suite', async (t) => {
    
    // Iniciar el servidor mcp.js como un proceso hijo stdio
    const mcpProcess = spawn('node', [path.join(__dirname, 'mcp.js')]);
    
    // Auxiliar para enviar un comando JSON-RPC y capturar la respuesta de stdout línea a línea
    const sendJsonRpc = (requestObj) => {
        return new Promise((resolve, reject) => {
            const onData = (data) => {
                // Desvincular handler de datos de inmediato para no solapar respuestas subsiguientes
                mcpProcess.stdout.removeListener('data', onData);
                try {
                    const lines = data.toString().split('\n').filter(l => l.trim());
                    if (lines.length > 0) {
                        const response = JSON.parse(lines[0]);
                        resolve(response);
                    } else {
                        reject(new Error("Respuesta vacía del servidor MCP"));
                    }
                } catch (e) {
                    reject(new Error(`Fallo al parsear respuesta JSON-RPC: ${data.toString()}`));
                }
            };

            mcpProcess.stdout.on('data', onData);
            
            // Escribir la solicitud en stdin con salto de línea obligatorio del protocolo
            mcpProcess.stdin.write(JSON.stringify(requestObj) + '\n');
        });
    };

    // Test 1: Conexión e inicialización inicial
    await t.test('JSON-RPC initialize - Negocia protocolo e informa metadatos del servidor', async () => {
        const initReq = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                clientInfo: {
                    name: "ClaudeDesktopTestClient",
                    version: "1.0.0"
                }
            }
        };

        const res = await sendJsonRpc(initReq);
        
        assert.strictEqual(res.jsonrpc, "2.0");
        assert.strictEqual(res.id, 1);
        assert.strictEqual(res.result.protocolVersion, "2024-11-05");
        assert.strictEqual(res.result.serverInfo.name, "FastMCP-API-Toolkit");
    });

    // Test 2: Listar herramientas expuestas
    await t.test('JSON-RPC tools/list - Retorna listado completo de tools registradas', async () => {
        const listReq = {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {}
        };

        const res = await sendJsonRpc(listReq);
        
        assert.strictEqual(res.jsonrpc, "2.0");
        assert.strictEqual(res.id, 2);
        
        const tools = res.result.tools;
        assert.ok(tools.some(t => t.name === "obtener_metricas"));
        assert.ok(tools.some(t => t.name === "guardar_log"));
        assert.ok(tools.some(t => t.name === "consultar_estado_api"));
    });

    // Test 3: Ejecución de herramienta obtener_metricas
    await t.test('JSON-RPC tools/call (obtener_metricas) - Retorna uso de RAM y CPU del proceso', async () => {
        const callReq = {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
                name: "obtener_metricas",
                arguments: {}
            }
        };

        const res = await sendJsonRpc(callReq);
        
        assert.strictEqual(res.jsonrpc, "2.0");
        assert.strictEqual(res.id, 3);
        assert.strictEqual(res.result.isError, false);
        
        const textContent = res.result.content[0].text;
        const metrics = JSON.parse(textContent);
        assert.strictEqual(metrics.mensaje, "Métricas leídas exitosamente");
        assert.ok(metrics.memoria.rss);
    });

    // Test 4: Ejecución de herramienta guardar_log y persistencia física en disco
    await t.test('JSON-RPC tools/call (guardar_log) - Persiste logs de auditoría de forma segura', async () => {
        const callReq = {
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: {
                name: "guardar_log",
                arguments: {
                    evento: "TEST_INTEGRACION",
                    detalles: "Ejecución de test de batería automática"
                }
            }
        };

        const res = await sendJsonRpc(callReq);
        
        assert.strictEqual(res.jsonrpc, "2.0");
        assert.strictEqual(res.id, 4);
        
        const textContent = res.result.content[0].text;
        const logStatus = JSON.parse(textContent);
        assert.strictEqual(logStatus.estado, "GUARDADO");
        
        // Verificar físicamente que el archivo de logs fue creado y contiene la línea escrita
        const logPath = path.join(__dirname, '.logs', 'audit.log');
        assert.ok(fs.existsSync(logPath));
        const fileContent = fs.readFileSync(logPath, 'utf8');
        assert.ok(fileContent.includes("TEST_INTEGRACION"));
        assert.ok(fileContent.includes("Ejecución de test de batería automática"));
    });

    // Test 5: Listar recursos expuestos
    await t.test('JSON-RPC resources/list - Retorna recursos de consulta contextual', async () => {
        const listReq = {
            jsonrpc: "2.0",
            id: 5,
            method: "resources/list",
            params: {}
        };

        const res = await sendJsonRpc(listReq);
        
        assert.strictEqual(res.jsonrpc, "2.0");
        const resources = res.result.resources;
        assert.ok(resources.some(r => r.uri === "sistema://estado"));
    });

    // Test 6: Lectura de recursos sistema://estado
    await t.test('JSON-RPC resources/read (sistema://estado) - Recupera JSON de configuración', async () => {
        const readReq = {
            jsonrpc: "2.0",
            id: 6,
            method: "resources/read",
            params: {
                uri: "sistema://estado"
            }
        };

        const res = await sendJsonRpc(readReq);
        
        assert.strictEqual(res.jsonrpc, "2.0");
        assert.strictEqual(res.id, 6);
        
        const text = res.result.contents[0].text;
        const state = JSON.parse(text);
        assert.strictEqual(state.node_version, process.version);
        assert.ok(state.memoria_rss);
    });

    // Test 7: Listar prompts y obtener plantilla explicativa
    await t.test('JSON-RPC prompts/list y prompts/get (explicar_mcp) - Entrega plantilla predefinida', async () => {
        const getReq = {
            jsonrpc: "2.0",
            id: 7,
            method: "prompts/get",
            params: {
                name: "explicar_mcp",
                arguments: {}
            }
        };

        const res = await sendJsonRpc(getReq);
        
        assert.strictEqual(res.jsonrpc, "2.0");
        assert.strictEqual(res.id, 7);
        
        const promptText = res.result.messages[0].content.text;
        assert.ok(promptText.includes("Model Context Protocol"));
        assert.ok(promptText.includes("obtener_metricas"));
    });

    // Test 8: Validar nuevas herramientas vectoriales y documentales en tools/list
    await t.test('JSON-RPC tools/list - Retorna las nuevas herramientas vectoriales y documentales', async () => {
        const listReq = {
            jsonrpc: "2.0",
            id: 8,
            method: "tools/list",
            params: {}
        };

        const res = await sendJsonRpc(listReq);
        assert.strictEqual(res.jsonrpc, "2.0");
        assert.strictEqual(res.id, 8);

        const tools = res.result.tools;
        assert.ok(tools.some(t => t.name === "list_vector_collections"));
        assert.ok(tools.some(t => t.name === "vector_upsert"));
        assert.ok(tools.some(t => t.name === "vector_search"));
        assert.ok(tools.some(t => t.name === "document_insert"));
        assert.ok(tools.some(t => t.name === "document_find"));
    });

    // Test 9: Validar nuevos recursos vectoriales y documentales en resources/list
    await t.test('JSON-RPC resources/list - Retorna los nuevos recursos de colecciones de vectores y documentos', async () => {
        const listReq = {
            jsonrpc: "2.0",
            id: 9,
            method: "resources/list",
            params: {}
        };

        const res = await sendJsonRpc(listReq);
        assert.strictEqual(res.jsonrpc, "2.0");
        assert.strictEqual(res.id, 9);

        const resources = res.result.resources;
        assert.ok(resources.some(r => r.uri === "vectores://colecciones"));
        assert.ok(resources.some(r => r.uri === "documentos://colecciones"));
    });

    // Test 10: Ejecución exitosa de list_vector_collections
    await t.test('JSON-RPC tools/call (list_vector_collections) - Retorna la lista de colecciones sin errores', async () => {
        const callReq = {
            jsonrpc: "2.0",
            id: 10,
            method: "tools/call",
            params: {
                name: "list_vector_collections",
                arguments: {
                    quantization: "float32"
                }
            }
        };

        const res = await sendJsonRpc(callReq);
        assert.strictEqual(res.jsonrpc, "2.0");
        assert.strictEqual(res.id, 10);
        assert.strictEqual(res.result.isError, false);

        const textContent = res.result.content[0].text;
        const result = JSON.parse(textContent);
        assert.strictEqual(result.estado, "EXITOSO");
        assert.strictEqual(result.cuantizacion, "float32");
        assert.ok(Array.isArray(result.colecciones));
    });

    // Al finalizar los subtests, apagar el subproceso mcp.js de forma limpia
    t.after(() => {
        mcpProcess.kill();
    });
});

