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

    // Test finalización: Cerrar el servidor activo de index.js para que el proceso de tests finalice limpiamente
    t.after(() => {
        const app = require('./index');
        if (app.server) {
            app.server.close();
        }
    });
});
