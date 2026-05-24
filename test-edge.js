const test = require('node:test');
const assert = require('node:assert');

test('FastAPI Edge (Cloudflare Workers) Integration Suite', async (t) => {
    // Importamos dinámicamente worker.js ya que se define como un Módulo ES (ESM)
    const { default: worker } = await import('./worker.js');

    // Mocks de entorno y contexto de Cloudflare
    const env = {};
    const ctx = {
        waitUntil: (promise) => promise
    };

    // Test 1: Endpoint raíz del Edge
    await t.test('GET / - Retorna respuesta exitosa en el Edge', async () => {
        const req = new Request('http://localhost/');
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('content-type'), 'application/json');
        
        const body = await res.json();
        assert.ok(body.mensaje.includes("FastAPI Edge en Cloudflare"));
        assert.strictEqual(body.documentacion, '/docs');
    });

    // Test 2: OpenAPI en el Edge
    await t.test('GET /openapi.json - Autogeneración del esquema OpenAPI en el Edge', async () => {
        const req = new Request('http://localhost/openapi.json');
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 200);
        const schema = await res.json();
        assert.strictEqual(schema.openapi, '3.0.0');
        assert.ok(schema.paths['/products']);
        assert.ok(schema.paths['/secure/deploy']);
    });

    // Test 3: Swagger UI en el Edge (Retorna HTML)
    await t.test('GET /docs - Sirve Swagger UI desde el Edge', async () => {
        const req = new Request('http://localhost/docs');
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('content-type'), 'text/html');
        const html = await res.text();
        assert.ok(html.includes('SwaggerUIBundle'));
    });

    // Test 4: Router modular - Lista productos
    await t.test('GET /products - Recupera lista de productos modulares del Edge', async () => {
        const req = new Request('http://localhost/products');
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.items.length, 2);
        assert.strictEqual(body.items[0].nombre, "Cloudflare KV");
    });

    // Test 5: Extracción de parámetros dinámicos de ruta en el Edge
    await t.test('GET /products/:id - Extrae el id dinámico en el Edge', async () => {
        const req = new Request('http://localhost/products/777');
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.producto_id, 777);
        assert.strictEqual(body.estado, "Disponible en caché perimetral");
    });

    // Test 6: Seguridad Edge - Bloqueo si falta token
    await t.test('POST /secure/deploy - Retorna 401 si falta cabecera Bearer', async () => {
        const req = new Request('http://localhost/secure/deploy', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                proyecto: "api-edge",
                ambiente: "produccion"
            })
        });
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 401);
        const body = await res.json();
        assert.strictEqual(body.status_code, 401);
        assert.ok(body.detail.includes("No autorizado"));
    });

    // Test 7: Seguridad Edge - Acceso exitoso y validación de cuerpo
    await t.test('POST /secure/deploy - Procesa despliegue con token y body válidos', async () => {
        const req = new Request('http://localhost/secure/deploy', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer edge-secret-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                proyecto: "fastapi-workers",
                ambiente: "staging"
            })
        });
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.mensaje, "Despliegue perimetral completado con éxito");
        assert.strictEqual(body.operador.username, "edge_developer");
        assert.strictEqual(body.body.proyecto, "fastapi-workers");
    });

    // Test 8: Validación de Esquema en el Edge - Falla si falta propiedad obligatoria
    await t.test('POST /secure/deploy - Falla con 400 si falta propiedad requerida en el cuerpo', async () => {
        const req = new Request('http://localhost/secure/deploy', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer edge-secret-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                proyecto: "api-sin-ambiente" // falta 'ambiente'
            })
        });
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 400);
        const body = await res.json();
        assert.ok(body.detail.includes("Error de validación"));
        assert.ok(body.errors.some(e => e.includes("'ambiente' es obligatorio")));
    });

    // Test 9: Vector endpoints - Upsert fallando por dimensiones inválidas
    await t.test('POST /vectors/upsert - Falla con 400 si la dimensión del vector es incorrecta', async () => {
        const req = new Request('http://localhost/vectors/upsert', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer edge-secret-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collection: "test-col",
                id: "vec-1",
                vector: [0.1, 0.2] // Dimensión incorrecta (espera 1536 para float32)
            })
        });
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 400);
        const body = await res.json();
        assert.ok(body.detail.includes("Dimensión de vector inválida"));
    });

    // Test 10: Vector endpoints - Build index no soportado en Edge
    await t.test('POST /vectors/build-index - Retorna 501 (Not Implemented) en el Edge', async () => {
        const req = new Request('http://localhost/vectors/build-index', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer edge-secret-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collection: "test-col"
            })
        });
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 501);
        const body = await res.json();
        assert.ok(body.detail.includes("no está soportado"));
    });

    // Test 11: Vector endpoints - Delete colección inexistente
    await t.test('DELETE /vectors/collections/:name - Retorna 404 para colección no encontrada', async () => {
        const req = new Request('http://localhost/vectors/collections/inexistente', {
            method: 'DELETE',
            headers: {
                'Authorization': 'Bearer edge-secret-token'
            }
        });
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 404);
        const body = await res.json();
        assert.ok(body.detail.includes("no encontrada"));
    });

    // Test 12: Vector endpoints - GET collections con quantization query param
    await t.test('GET /vectors/collections?quantization=int8 - Lee quantization del query param', async () => {
        const req = new Request('http://localhost/vectors/collections?quantization=int8', {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer edge-secret-token'
            }
        });
        const res = await worker.fetch(req, env, ctx);
        
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.quantization, 'int8');
    });

    // Test 13: Vector endpoints - Búsqueda Híbrida simétrica en el Edge
    await t.test('POST /vectors/search-hybrid - Valida búsqueda híbrida simétrica en el Edge', async () => {
        const upsertReq = new Request('http://localhost/vectors/upsert', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer edge-secret-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collection: "edge-hybrid-col",
                id: "doc-edge-1",
                vector: new Array(768).fill(0.1),
                metadata: { text: "Cloudflare Workers y Pages Functions con bases de datos" }
            })
        });
        await worker.fetch(upsertReq, env, ctx);

        const searchReq = new Request('http://localhost/vectors/search-hybrid', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer edge-secret-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collection: "edge-hybrid-col",
                vector: new Array(768).fill(0.1),
                text: "Cloudflare Workers",
                limit: 1,
                alpha: 0.5
            })
        });
        const res = await worker.fetch(searchReq, env, ctx);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.mensaje, "Búsqueda híbrida completada en el Edge");
        assert.strictEqual(body.resultados.length, 1);
        assert.strictEqual(body.resultados[0].id, "doc-edge-1");
    });
});

