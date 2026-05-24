process.env.PORT = '8999';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Limpiar la base de datos de pruebas (.data/) antes de arrancar para asegurar consistencia absoluta
const dbPath = path.resolve(__dirname, '.data');
function deleteRecursive(dir) {
    if (fs.existsSync(dir)) {
        const list = fs.readdirSync(dir);
        for (const file of list) {
            const curPath = path.join(dir, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteRecursive(curPath);
            } else {
                try {
                    fs.unlinkSync(curPath);
                } catch (e) {}
            }
        }
        try {
            fs.rmdirSync(dir);
        } catch (e) {}
    }
}
deleteRecursive(dbPath);

// Esperar un breve momento para garantizar que el servidor principal en index.js se haya inicializado por completo en el puerto 8999
const BASE_URL = 'http://localhost:8999';
const app = require('./index');

test('FastAPI Vanilla JS Integration Suite', async (t) => {
    // Espera determinista y sin condiciones de carrera a que seedDatabase termine el sembrado de usuarios en segundo plano
    const { auth, ensureAuthInit } = require('./dependencies/auth');
    await ensureAuthInit();
    let retries = 100;
    while (retries > 0 && auth.listUsers().length < 2) {
        await new Promise(resolve => setTimeout(resolve, 10));
        retries--;
    }
    
    // Test 1: Endpoint raíz
    await t.test('GET / - Retorna mensaje de bienvenida e índices de endpoints', async () => {
        const res = await fetch(`${BASE_URL}/`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('content-type'), 'application/json');
        
        const data = await res.json();
        assert.ok(data.mensaje.includes("FastAPI Vanilla JS"));
        assert.strictEqual(data.documentacion, '/docs');
    });

    // Test 2: OpenAPI Schema
    await t.test('GET /openapi.json - Entrega esquema OpenAPI 3.0 válido', async () => {
        const res = await fetch(`${BASE_URL}/openapi.json`);
        assert.strictEqual(res.status, 200);
        
        const schema = await res.json();
        assert.strictEqual(schema.openapi, '3.0.0');
        assert.ok(schema.paths['/users']);
        assert.ok(schema.paths['/items']);
    });

    // Test 3: Enrutador de Usuarios con Query por defecto
    await t.test('GET /users - Recupera listado con filtros query por defecto', async () => {
        const res = await fetch(`${BASE_URL}/users`);
        assert.strictEqual(res.status, 200);
        
        const body = await res.json();
        assert.strictEqual(body.filtros.limit, 10);
        assert.strictEqual(body.filtros.activo, true);
        assert.strictEqual(body.data.length, 2);
    });

    // Test 4: Extracción de parámetros dinámicos de ruta
    await t.test('GET /users/:id - Extrae el id de ruta correctamente', async () => {
        const res = await fetch(`${BASE_URL}/users/42`);
        assert.strictEqual(res.status, 200);
        
        const body = await res.json();
        assert.strictEqual(body.id, 42);
        assert.strictEqual(body.name, 'Usuario 42');
    });

    // Test 5: Servidor de archivos estáticos nativo
    await t.test('GET /static/index.html - Sirve archivo HTML físico', async () => {
        const res = await fetch(`${BASE_URL}/static/index.html`);
        assert.strictEqual(res.status, 200);
        assert.ok(res.headers.get('content-type').includes('text/html'));
        
        const text = await res.text();
        assert.ok(text.includes('Servidor de Archivos Estáticos Nativo'));
    });

    // Test 6: Seguridad - Bloqueo de peticiones sin token Bearer
    await t.test('GET /items - Bloquea petición no autenticada con 401', async () => {
        const res = await fetch(`${BASE_URL}/items`);
        assert.strictEqual(res.status, 401);
        
        const body = await res.json();
        assert.strictEqual(body.detail, "No autorizado. Se requiere Token Bearer.");
    });

    // Test 7: Seguridad - Acceso permitido con token Bearer correcto
    await t.test('GET /items - Acceso exitoso con cabecera de autenticación válida', async () => {
        const res = await fetch(`${BASE_URL}/items`, {
            headers: {
                'Authorization': 'Bearer super-secret-token'
            }
        });
        assert.strictEqual(res.status, 200);
        
        const body = await res.json();
        assert.ok(body.mensaje.includes("seguro"));
        assert.strictEqual(body.usuario.username, "admin_user");
        assert.strictEqual(body.items.length, 2);
    });

    // Test 8: Validación de Cuerpo - Falla si faltan campos obligatorios
    await t.test('POST /items - Falla con 400 por campos obligatorios faltantes', async () => {
        const res = await fetch(`${BASE_URL}/items`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer super-secret-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                precio: 50 // falta campo 'nombre'
            })
        });
        assert.strictEqual(res.status, 400);
        
        const body = await res.json();
        assert.strictEqual(body.detail, "Error de validación en cuerpo (body)");
        assert.ok(body.errors.some(e => e.includes("'nombre' es obligatorio")));
    });

    // Test 9: Flujo completo exitoso - Creación de recurso seguro y validado
    await t.test('POST /items - Crea ítem correctamente con datos válidos', async () => {
        const payload = {
            nombre: "Teclado Mecánico",
            precio: 85,
            en_oferta: true
        };
        const res = await fetch(`${BASE_URL}/items`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer super-secret-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        assert.strictEqual(res.status, 200);
        
        const body = await res.json();
        assert.strictEqual(body.mensaje, "Ítem guardado con éxito");
        assert.strictEqual(body.item.nombre, "Teclado Mecánico");
        assert.strictEqual(body.item.precio, 85);
        assert.strictEqual(body.item.en_oferta, true);
    });

    // --- NUEVAS PRUEBAS DE INTEGRACIÓN PERSISTENTES (js-doc-store) ---

    // Test 10: Registrar un usuario real en la base de datos
    await t.test('POST /auth/register - Registra un usuario real con cifrado PBKDF2', async () => {
        const payload = {
            email: "developer@test.com",
            password: "SecurePassword123!",
            name: "Dev User"
        };
        const res = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        assert.strictEqual(res.status, 200);
        
        const body = await res.json();
        assert.strictEqual(body.mensaje, "Usuario registrado con éxito");
        assert.strictEqual(body.usuario.email, "developer@test.com");
        assert.strictEqual(body.usuario.name, "Dev User");
        assert.ok(body.usuario._id);
        assert.strictEqual(body.usuario.passwordHash, undefined); // Protege hash
    });

    // Test 11: Iniciar sesión real y obtener JWT criptográfico
    await t.test('POST /auth/login - Loguea usuario y firma token JWT nativo', async () => {
        const payload = {
            email: "developer@test.com",
            password: "SecurePassword123!"
        };
        const res = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        assert.strictEqual(res.status, 200);
        
        const body = await res.json();
        assert.strictEqual(body.mensaje, "Login exitoso");
        assert.ok(body.token);
        assert.strictEqual(body.usuario.email, "developer@test.com");
    });

    // Test 12: Acceso a ruta segura usando el JWT real de js-doc-store
    await t.test('GET /items - Acceso exitoso usando JWT criptográfico real', async () => {
        // Realizar login de forma independiente para garantizar aislamiento del test
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: "developer@test.com",
                password: "SecurePassword123!"
            })
        });
        assert.strictEqual(loginRes.status, 200);
        const loginBody = await loginRes.json();
        const token = loginBody.token;

        const res = await fetch(`${BASE_URL}/items`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        assert.strictEqual(res.status, 200);
        
        const body = await res.json();
        assert.strictEqual(body.usuario.email, "developer@test.com");
        assert.ok(body.items);
    });
    // --- NUEVAS PRUEBAS DE BASE DE DATOS VECTORIAL (js-vector-store) ---

    // Generar vectores mocks distinguibles de 768d con dirección angular distinta
    const makeVector = (val) => {
        const vec = new Array(768).fill(0);
        vec[0] = val;
        vec[1] = 1 - val;
        return vec;
    };

    // Test 13: Upsert de Vectores en el almacén persistente
    await t.test('POST /vectors/upsert - Almacena embeddings reales con metadata en canal seguro', async () => {
        // Obtenemos token para realizar peticiones seguras
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: "developer@test.com",
                password: "SecurePassword123!"
            })
        });
        const loginBody = await loginRes.json();
        const token = loginBody.token;

        // Upsert Vector 1 (Medicina y salud)
        const res1 = await fetch(`${BASE_URL}/vectors/upsert`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collection: "docs",
                id: "med-1",
                vector: makeVector(0.9),
                metadata: { category: "medicina", tags: ["salud", "ia"] }
            })
        });
        assert.strictEqual(res1.status, 200);
        const body1 = await res1.json();
        assert.strictEqual(body1.mensaje, "Vector indexado con éxito");
        assert.strictEqual(body1.id, "med-1");

        // Upsert Vector 2 (Tecnología y computación)
        const res2 = await fetch(`${BASE_URL}/vectors/upsert`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collection: "docs",
                id: "tech-1",
                vector: makeVector(0.2),
                metadata: { category: "tecnología", tags: ["computadoras", "ia"] }
            })
        });
        assert.strictEqual(res2.status, 200);
    });

    // Test 14: Búsqueda Semántica con similitud Coseno y filtros de metadatos
    await t.test('POST /vectors/search - Realiza búsqueda semántica bruta y aplica filtros', async () => {
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: "developer@test.com",
                password: "SecurePassword123!"
            })
        });
        const loginBody = await loginRes.json();
        const token = loginBody.token;

        // Búsqueda sin filtros
        const searchRes = await fetch(`${BASE_URL}/vectors/search`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collection: "docs",
                vector: makeVector(0.95),
                limit: 2,
                metric: "cosine"
            })
        });
        assert.strictEqual(searchRes.status, 200);
        const searchBody = await searchRes.json();
        assert.strictEqual(searchBody.resultados.length, 2);
        assert.strictEqual(searchBody.resultados[0].id, "med-1"); // Por similitud de primer elemento (0.95 vs 0.9)

        // Búsqueda con filtro de metadatos
        const filteredRes = await fetch(`${BASE_URL}/vectors/search`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collection: "docs",
                vector: makeVector(0.95),
                limit: 2,
                filter: { category: "tecnología" }
            })
        });
        assert.strictEqual(filteredRes.status, 200);
        const filteredBody = await filteredRes.json();
        assert.strictEqual(filteredBody.resultados.length, 1);
        assert.strictEqual(filteredBody.resultados[0].id, "tech-1");
    });

    // Test 15: Búsqueda Dimensional Matryoshka progresiva
    await t.test('POST /vectors/search-matryoshka - Evalúa slices dimensionales progresivos', async () => {
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: "developer@test.com",
                password: "SecurePassword123!"
            })
        });
        const loginBody = await loginRes.json();
        const token = loginBody.token;

        const res = await fetch(`${BASE_URL}/vectors/search-matryoshka`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collection: "docs",
                vector: makeVector(0.85),
                stages: [128, 384, 768],
                limit: 1
            })
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.resultados.length, 1);
        assert.strictEqual(body.resultados[0].id, "med-1");
    });

    // Test 16: Construcción de Índice IVF y búsqueda semántica indexada
    await t.test('POST /vectors/build-index - Construye clúster K-means y busca de forma sub-lineal', async () => {
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: "developer@test.com",
                password: "SecurePassword123!"
            })
        });
        const loginBody = await loginRes.json();
        const token = loginBody.token;

        // Construir índice IVF
        const buildRes = await fetch(`${BASE_URL}/vectors/build-index`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collection: "docs",
                numClusters: 2,
                numProbes: 1
            })
        });
        assert.strictEqual(buildRes.status, 200);
        const buildBody = await buildRes.json();
        assert.strictEqual(buildBody.mensaje, "Índice invertido IVF K-means construido con éxito");
        assert.strictEqual(buildBody.clusters, 2);

        // Búsqueda sobre el índice IVF construido
        const searchRes = await fetch(`${BASE_URL}/vectors/search`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collection: "docs",
                vector: makeVector(0.15),
                limit: 1
            })
        });
        assert.strictEqual(searchRes.status, 200);
        const searchBody = await searchRes.json();
        assert.strictEqual(searchBody.resultados.length, 1);
        assert.strictEqual(searchBody.resultados[0].id, "tech-1"); // Más cercano a 0.15 (0.2 vs 0.9)
    });

    // Test 17: Búsqueda Semántica con Cuantización Vectorial Dinámica (Int8, 1-Bit, 3-Bit Polar)
    await t.test('POST /vectors/upsert y /search (Cuantización) - Almacena y busca con compresión Int8, Binary y Polar', async () => {
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: "developer@test.com",
                password: "SecurePassword123!"
            })
        });
        const loginBody = await loginRes.json();
        const token = loginBody.token;

        const modes = ['int8', 'binary', 'polar'];
        for (const mode of modes) {
            // Upsert en el almacén cuantizado
            const upsertRes = await fetch(`${BASE_URL}/vectors/upsert`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    collection: "docs-quant",
                    id: `med-${mode}`,
                    vector: makeVector(0.9),
                    metadata: { category: "medicina", mode },
                    quantization: mode
                })
            });
            assert.strictEqual(upsertRes.status, 200, `Upsert falló en modo cuantizado: ${mode}`);
            const upsertBody = await upsertRes.json();
            assert.strictEqual(upsertBody.quantization, mode);

            // Búsqueda en el almacén cuantizado
            const searchRes = await fetch(`${BASE_URL}/vectors/search`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    collection: "docs-quant",
                    vector: makeVector(0.95),
                    limit: 1,
                    metric: "cosine",
                    quantization: mode
                })
            });
            assert.strictEqual(searchRes.status, 200, `Search falló en modo cuantizado: ${mode}`);
            const searchBody = await searchRes.json();
            assert.strictEqual(searchBody.resultados.length, 1);
            assert.strictEqual(searchBody.resultados[0].id, `med-${mode}`, `Búsqueda falló en modo: ${mode}`);
            assert.strictEqual(searchBody.quantization, mode);
        }
    });

    // Test 18: Búsqueda Híbrida Semántica y Léxica (Dense + BM25)
    await t.test('POST /vectors/search-hybrid - Valida fusión de score léxico (BM25) y semántico (Dense)', async (t) => {
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: "developer@test.com",
                password: "SecurePassword123!"
            })
        });
        const loginBody = await loginRes.json();
        const token = loginBody.token;

        // Upsert Documento 1 (Cercano a 0.1 vectorialmente, habla de inteligencia artificial)
        await fetch(`${BASE_URL}/vectors/upsert`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: "hybrid-test-col",
                id: "hybrid-doc-1",
                vector: makeVector(0.1),
                metadata: { text: "Búsqueda híbrida con BM25 e inteligencia artificial en el Edge" }
            })
        });

        // Upsert Documento 2 (Cercano a 0.9 vectorialmente, habla de medicina avanzada)
        await fetch(`${BASE_URL}/vectors/upsert`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: "hybrid-test-col",
                id: "hybrid-doc-2",
                vector: makeVector(0.9),
                metadata: { text: "La medicina avanzada y tratamientos de salud en hospitales" }
            })
        });

        // Caso 1: Búsqueda Léxica pura (alpha = 0.0) buscando "BM25 inteligencia"
        // Debe ganar hybrid-doc-1
        const resLexical = await fetch(`${BASE_URL}/vectors/search-hybrid`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: "hybrid-test-col",
                vector: makeVector(0.95), // Cercano a doc-2
                text: "BM25 inteligencia",
                limit: 1,
                alpha: 0.0
            })
        });
        assert.strictEqual(resLexical.status, 200);
        const bodyLexical = await resLexical.json();
        assert.strictEqual(bodyLexical.resultados.length, 1);
        assert.strictEqual(bodyLexical.resultados[0].id, "hybrid-doc-1");

        // Caso 2: Búsqueda Semántica pura (alpha = 1.0) buscando "BM25 inteligencia" pero con vector 0.95
        // Debe ganar hybrid-doc-2 (cercano a 0.95 vs 0.1)
        const resSemantic = await fetch(`${BASE_URL}/vectors/search-hybrid`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: "hybrid-test-col",
                vector: makeVector(0.95),
                text: "BM25 inteligencia",
                limit: 1,
                alpha: 1.0
            })
        });
        assert.strictEqual(resSemantic.status, 200);
        const bodySemantic = await resSemantic.json();
        assert.strictEqual(bodySemantic.resultados.length, 1);
        assert.strictEqual(bodySemantic.resultados[0].id, "hybrid-doc-2");
    });

    // Test 19: Paginación Cursada en Búsqueda Semántica
    await t.test('POST /vectors/search - Valida paginación cursada con cursor Base64 (nextCursor)', async (t) => {
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: "developer@test.com",
                password: "SecurePassword123!"
            })
        });
        const loginBody = await loginRes.json();
        const token = loginBody.token;

        // Upsert 3 documentos
        await fetch(`${BASE_URL}/vectors/upsert`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: "page-test-col",
                id: "pdoc-1",
                vector: makeVector(0.1),
                metadata: { text: "Doc uno" }
            })
        });

        await fetch(`${BASE_URL}/vectors/upsert`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: "page-test-col",
                id: "pdoc-2",
                vector: makeVector(0.2),
                metadata: { text: "Doc dos" }
            })
        });

        await fetch(`${BASE_URL}/vectors/upsert`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: "page-test-col",
                id: "pdoc-3",
                vector: makeVector(0.3),
                metadata: { text: "Doc tres" }
            })
        });

        // 1. Obtener primera página (limit = 1)
        const res1 = await fetch(`${BASE_URL}/vectors/search`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: "page-test-col",
                vector: makeVector(0.12),
                limit: 1
            })
        });
        assert.strictEqual(res1.status, 200);
        const body1 = await res1.json();
        assert.strictEqual(body1.resultados.length, 1);
        assert.ok(body1.nextCursor);

        // 2. Obtener segunda página usando nextCursor
        const res2 = await fetch(`${BASE_URL}/vectors/search`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: "page-test-col",
                vector: makeVector(0.12),
                limit: 1,
                cursor: body1.nextCursor
            })
        });
        assert.strictEqual(res2.status, 200);
        const body2 = await res2.json();
        assert.strictEqual(body2.resultados.length, 1);
        assert.notStrictEqual(body2.resultados[0].id, body1.resultados[0].id);
        assert.ok(body2.nextCursor);

        // 3. Obtener tercera página (debe ser la última, nextCursor = null)
        const res3 = await fetch(`${BASE_URL}/vectors/search`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: "page-test-col",
                vector: makeVector(0.12),
                limit: 1,
                cursor: body2.nextCursor
            })
        });
        assert.strictEqual(res3.status, 200);
        const body3 = await res3.json();
        assert.strictEqual(body3.resultados.length, 1);
        assert.strictEqual(body3.nextCursor, null);
    });

    // Test 20: Serialización y Compresión de Estado BM25 mediante Mapeo Posicional de IDs de Enteros
    await t.test('BM25 Index - Valida compresión y mapeo posicional en el manifiesto JSON', async (t) => {
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: "developer@test.com",
                password: "SecurePassword123!"
            })
        });
        const loginBody = await loginRes.json();
        const token = loginBody.token;

        const collectionName = "bm25-compress-col";

        // Upsert 2 documentos con contenido de texto para generar el índice BM25
        await fetch(`${BASE_URL}/vectors/upsert`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: collectionName,
                id: "c-doc-1",
                vector: makeVector(0.1),
                metadata: { text: "inteligencia artificial perimetral en cloudflare edge" }
            })
        });

        await fetch(`${BASE_URL}/vectors/upsert`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: collectionName,
                id: "c-doc-2",
                vector: makeVector(0.2),
                metadata: { text: "medicina de precisión y salud digital avanzada" }
            })
        });

        // Trigger del flush del motor haciendo una búsqueda híbrida
        const searchRes = await fetch(`${BASE_URL}/vectors/search-hybrid`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: collectionName,
                vector: makeVector(0.12),
                text: "inteligencia precisión",
                limit: 2,
                alpha: 0.5
            })
        });
        assert.strictEqual(searchRes.status, 200);
        const searchBody = await searchRes.json();
        assert.strictEqual(searchBody.resultados.length, 2);

        // Leer el archivo de manifiesto directamente del disco para validar el formato de compresión
        const fs = require('fs');
        const path = require('path');
        const manifestPath = path.resolve(__dirname, '.data', 'vectors', `${collectionName}.json`);
        
        assert.ok(fs.existsSync(manifestPath), "El manifiesto JSON debería haber sido persistido en disco.");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        // Validaciones del esquema comprimido de BM25
        assert.ok(manifest.bm25, "El manifiesto debe incluir la propiedad de estado BM25.");
        assert.ok(Array.isArray(manifest.bm25.vocab), "El estado BM25 debe contener un vocabulario de tipo Array.");
        assert.ok(Array.isArray(manifest.bm25.lens), "El estado BM25 debe contener lens de tipo Array.");
        assert.ok(Array.isArray(manifest.bm25.postings), "El estado BM25 debe contener postings de tipo Array.");

        // Validar que no contenga referencias repetitivas a docId strings en el estado postings
        const rawJsonString = JSON.stringify(manifest.bm25);
        assert.ok(!rawJsonString.includes("c-doc-1"), "El estado comprimido no debe contener strings repetitivos de docId.");
        assert.ok(!rawJsonString.includes("c-doc-2"), "El estado comprimido no debe contener strings repetitivos de docId.");

        // Validar que el mapeo e hidratación sea funcional haciendo una búsqueda idéntica
        // (esto forzará cargar de nuevo desde disco en un nuevo proceso/estado limpio)
        // Eliminamos de memoria de colecciones cargadas para simular un inicio en frío
        const vectorDb = require('./dependencies/vector');
        const store = vectorDb.getStore('float32');
        store._collections.delete(collectionName);
        store.bm25._data.delete(collectionName);

        const searchResAfterLoad = await fetch(`${BASE_URL}/vectors/search-hybrid`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: collectionName,
                vector: makeVector(0.12),
                text: "inteligencia precisión",
                limit: 2,
                alpha: 0.5
            })
        });
        const bodyAfterLoad = await searchResAfterLoad.json();
        assert.strictEqual(bodyAfterLoad.resultados.length, 2);
        assert.strictEqual(bodyAfterLoad.resultados[0].id, searchBody.resultados[0].id, "Las búsquedas deben retornar el mismo resultado exacto tras la deserialización.");
        assert.strictEqual(bodyAfterLoad.resultados[0].score, searchBody.resultados[0].score, "Los scores deben coincidir al 100% tras la deserialización.");
    });

    // Test 21: Encriptación Perimetral y Local AES-256-GCM sobre JSON y Binarios
    await t.test('AES-256-GCM Encryption - Valida encriptación transparente de JSON y embeddings binarios en reposo', async (t) => {
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: "developer@test.com",
                password: "SecurePassword123!"
            })
        });
        const loginBody = await loginRes.json();
        const token = loginBody.token;

        const collectionName = "enc-test-col";

        // 1. Configurar llave de encriptación temporal en el proceso
        process.env.ENCRYPTION_KEY = "super-secret-crypto-password-123";

        // Forzar re-inicialización del adaptador criptográfico local
        const vectorDb = require('./dependencies/vector');
        const store = vectorDb.getStore('float32');
        
        // Limpiar cualquier estado previo
        store._collections.delete(collectionName);
        store.bm25._data.delete(collectionName);
        
        // Resetear bandera de inicialización para forzar creación de EncryptedStorageAdapter
        const { EncryptedStorageAdapter, FileStorageAdapter } = require('./lib/js-vector-store');
        const path = require('path');
        const vectorPath = path.resolve(__dirname, '.data', 'vectors');
        const fileAdapter = new FileStorageAdapter(vectorPath);
        const encAdapter = await EncryptedStorageAdapter.create(fileAdapter, process.env.ENCRYPTION_KEY);
        
        // Vincular adaptador cifrado a todas las instancias locales
        for (const s of Object.values(vectorDb.stores)) {
            s._adapter = encAdapter;
        }

        // 2. Upsert de documentos (cifrará JSON y BIN al persistir)
        const upsertRes = await fetch(`${BASE_URL}/vectors/upsert`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: collectionName,
                id: "e-doc-1",
                vector: makeVector(0.25),
                metadata: { text: "información secreta corporativa encriptada" }
            })
        });
        assert.strictEqual(upsertRes.status, 200);

        // 3. Verificar que los archivos estén físicamente cifrados en reposo en disco
        const fs = require('fs');
        const jsonPath = path.resolve(vectorPath, `${collectionName}.json`);
        const binPath = path.resolve(vectorPath, `${collectionName}.bin`);

        assert.ok(fs.existsSync(jsonPath), "El manifiesto JSON encriptado debería existir.");
        assert.ok(fs.existsSync(binPath), "El vector binario encriptado debería existir.");

        // Validar cifrado del manifiesto JSON
        const rawJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        assert.ok(rawJson.__enc, "El JSON manifiesto debe estar envuelto bajo la propiedad '__enc'.");
        assert.ok(!rawJson.ids, "El JSON manifiesto no debe revelar las claves 'ids' en claro.");
        assert.ok(!rawJson.meta, "El JSON manifiesto no debe revelar las claves 'meta' en claro.");

        // Validar cifrado del archivo binario
        const rawBin = fs.readFileSync(binPath);
        // Dado que son 768 float32 (3072 bytes) + 12 bytes IV + 16 bytes GCM tag = 3100 bytes
        assert.strictEqual(rawBin.byteLength, 3100, "El binario encriptado debe tener el overhead de 28 bytes de AES-GCM.");

        // 4. Búsqueda híbrida para verificar que la desencriptación síncrona en memoria funciona
        const searchRes1 = await fetch(`${BASE_URL}/vectors/search-hybrid`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: collectionName,
                vector: makeVector(0.24),
                text: "información",
                limit: 1,
                alpha: 0.5
            })
        });
        assert.strictEqual(searchRes1.status, 200);
        const searchBody1 = await searchRes1.json();
        assert.strictEqual(searchBody1.resultados.length, 1);
        assert.strictEqual(searchBody1.resultados[0].id, "e-doc-1");

        // 5. Simular Cold Start (borrar cache en memoria de todas las instancias)
        store._collections.delete(collectionName);
        store.bm25._data.delete(collectionName);

        // Volver a buscar (forzará la descarga y descifrado asíncrono desde el disco)
        const searchRes2 = await fetch(`${BASE_URL}/vectors/search-hybrid`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: collectionName,
                vector: makeVector(0.24),
                text: "información",
                limit: 1,
                alpha: 0.5
            })
        });
        assert.strictEqual(searchRes2.status, 200);
        const searchBody2 = await searchRes2.json();
        assert.strictEqual(searchBody2.resultados.length, 1);
        assert.strictEqual(searchBody2.resultados[0].id, "e-doc-1", "Debe descifrar e indexar correctamente tras cold start.");

        // 6. Limpieza y restauración del entorno limpio sin encriptación
        delete process.env.ENCRYPTION_KEY;
        for (const s of Object.values(vectorDb.stores)) {
            s._adapter = fileAdapter; // restaurar adaptador limpio
            s._collections.delete(collectionName);
            s.bm25._data.delete(collectionName);
        }
        
        // Borrar archivos de prueba
        if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
        if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
    });

    await t.test('WordPress-style CPT - Valida creación de CPT, inserción, actualización (PUT) y eliminación de esquema (DELETE)', async () => {
        // 1. Iniciar sesión para obtener el token JWT
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@test.com', password: 'password123' })
        });
        assert.strictEqual(loginRes.status, 200);
        const { token } = await loginRes.json();

        // 2. Registrar CPT 'libros'
        const cptRes = await fetch(`${BASE_URL}/cpts/schemas`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: "libros",
                columns: [
                    { name: 'titulo', type: 'text', required: true },
                    { name: 'paginas', type: 'number', required: false }
                ]
            })
        });
        assert.strictEqual(cptRes.status, 200);
        const cptBody = await cptRes.json();
        assert.strictEqual(cptBody.cpt.name, 'libros');

        // 3. Insertar un libro
        const insertRes = await fetch(`${BASE_URL}/cpts/libros`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: "El Hobbit",
                paginas: 310
            })
        });
        assert.strictEqual(insertRes.status, 200);
        const insertBody = await insertRes.json();
        const bookId = insertBody.documento._id;
        assert.ok(bookId);
        assert.strictEqual(insertBody.documento.titulo, 'El Hobbit');
        assert.strictEqual(insertBody.documento.paginas, 310);

        // 4. Actualizar libro (PUT)
        const updateRes = await fetch(`${BASE_URL}/cpts/libros/${bookId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: "El Hobbit Pro",
                paginas: 320
            })
        });
        assert.strictEqual(updateRes.status, 200);
        const updateBody = await updateRes.json();
        assert.strictEqual(updateBody.documento.titulo, 'El Hobbit Pro');
        assert.strictEqual(updateBody.documento.paginas, 320);

        // 5. Leer colección libros y verificar que persisten cambios tras PUT
        const getRes = await fetch(`${BASE_URL}/cpts/libros`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        assert.strictEqual(getRes.status, 200);
        const getBody = await getRes.json();
        assert.strictEqual(getBody.conteo, 1);
        assert.strictEqual(getBody.documentos[0].titulo, 'El Hobbit Pro');
        assert.strictEqual(getBody.documentos[0].paginas, 320);

        // 6. Eliminar el esquema de libros y todos sus datos
        const deleteRes = await fetch(`${BASE_URL}/cpts/schemas/libros`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        assert.strictEqual(deleteRes.status, 200);
        const deleteBody = await deleteRes.json();
        assert.ok(deleteBody.mensaje.includes("eliminados con éxito"));

        // 7. Intentar consultar libros y recibir 404 (CPT no existe)
        const getDeletedRes = await fetch(`${BASE_URL}/cpts/libros`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        assert.strictEqual(getDeletedRes.status, 404);
    });

    // Test finalización: Cerrar el servidor activo de index.js para que el proceso de tests finalice limpiamente
    t.after(() => {
        const app = require('./index');
        if (app.server) {
            app.server.close();
        }
    });
});
