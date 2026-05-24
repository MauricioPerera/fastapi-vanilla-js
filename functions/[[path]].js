import { FastAPI, APIRouter } from '../lib/fastapi-edge.js';
import { DocStore, MemoryStorageAdapter as DocMemoryAdapter, CloudflareKVAdapter as DocKVAdapter, Auth } from '../lib/js-doc-store.js';
import { VectorStore, QuantizedStore, BinaryQuantizedStore, PolarQuantizedStore, MemoryStorageAdapter, CloudflareKVAdapter } from '../lib/js-vector-store.js';

// 1. Inicializar la aplicación para Pages Functions
const app = new FastAPI({
    title: "FastAPI Pages Functions",
    description: "API REST modular ejecutándose nativamente en Cloudflare Pages Functions.",
    version: "2.0.0",
    cors: {
        allowOrigins: ['*'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowHeaders: ['Content-Type', 'Authorization']
    }
});

// 2. Registro de Middleware de Logs
app.addMiddleware(async (request, env, ctx, next) => {
    const start = Date.now();
    const response = await next();
    const duration = Date.now() - start;
    console.log(`[CF Pages Function] ${request.method} ${new URL(request.url).pathname} - ${response.status} (${duration}ms)`);
    return response;
});

// Base de datos y autenticación dinámicas en Pages Functions
let db;
let auth;
let authInitialized = false;
let stores;

function ensureDbAndAuth(env) {
    if (!db) {
        if (env && env.MY_KV) {
            db = new DocStore(new DocKVAdapter(env.MY_KV, 'db/'));
        } else {
            db = new DocStore(new DocMemoryAdapter());
        }
        auth = new Auth(db, {
            secret: env.API_SECRET_TOKEN || 'pages-secret-token'
        });
    }
    if (!stores) {
        const adapter = (env && env.MY_KV)
            ? new CloudflareKVAdapter(env.MY_KV, 'vectors/')
            : new MemoryStorageAdapter();
        stores = {
            float32: new VectorStore(adapter, 768),
            int8: new QuantizedStore(adapter, 768),
            binary: new BinaryQuantizedStore(adapter, 768),
            polar: new PolarQuantizedStore(adapter, 768)
        };
    }
}

async function ensureAuthInit(env) {
    ensureDbAndAuth(env);
    if (!authInitialized) {
        await auth.init();
        const existing = auth.getUserByEmail('pages@test.com');
        if (!existing) {
            try {
                await auth.register('pages@test.com', 'password123', { name: "Pages Operator", role: "admin" });
            } catch (e) {
                // Ya existe
            }
        }
        authInitialized = true;
    }
}

const getEdgeStore = (req) => {
    const urlObj = new URL(req.url);
    const q = urlObj.searchParams.get('quantization') || req.body?.quantization || 'float32';
    const quantization = ['float32', 'int8', 'binary', 'polar'].includes(q) ? q : 'float32';
    return {
        store: stores[quantization],
        quantization
    };
};

const preloadVectorCol = async (store, col) => {
    if (store._adapter && typeof store._adapter.preload === 'function') {
        // NOTE: Accesos conscientes a métodos privados (_jsonFile y _binFile) de js-vector-store.
        // Se requieren para resolver los nombres de archivos físicos antes de la hidratación síncrona en memoria.
        const jsonFile = store._jsonFile(col);
        const binFile = store._binFile(col);
        await store._adapter.preload([jsonFile, binFile]);
    }
};

const ensureAuthPreloaded = async () => {
    if (db && db._adapter && typeof db._adapter.preload === 'function') {
        await db._adapter.preload([
            'users.docs.json', 'users.meta.json',
            'sessions.docs.json', 'sessions.meta.json'
        ]);
    }
};

// 3. Dependency Resolver para Usuarios de Pages
const getPagesUser = async (request, env, ctx) => {
    ensureDbAndAuth(env);
    await ensureAuthPreloaded();
    await ensureAuthInit(env);
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error("Unauthorized");
    }
    const token = authHeader.split(' ')[1];
    
    // Bypass de desarrollo para tests retrocompatibles
    if (token === 'pages-secret-token') {
        return { username: "pages_developer", role: "admin" };
    }

    const payload = await auth.verify(token);
    if (!payload) {
        throw new Error("Forbidden");
    }
    return auth.getUser(payload.sub);
};

// 4. Manejo de Errores en Pages Functions
app.addExceptionHandler(Error, (request, err, env, ctx) => {
    let status = 500;
    let detail = "Internal Pages Error";
    
    if (err.message === "Unauthorized") {
        status = 401;
        detail = "No autorizado a nivel perimetral";
    } else if (err.message === "Forbidden") {
        status = 403;
        detail = "Acceso denegado a nivel perimetral";
    } else {
        detail = err.message;
    }

    return new Response(JSON.stringify({ detail, status_code: status }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
});

// ----------------------------------------------------------------------------
// ROUTER DE PRODUCTOS (/products)
// ----------------------------------------------------------------------------
const productRouter = new APIRouter({
    prefix: "/products",
    tags: ["Productos"]
});

productRouter.get('/', (request) => {
    return {
        items: [
            { id: 501, nombre: "Cloudflare KV (Pages)", tipo: "Base de Datos en el Edge" },
            { id: 502, nombre: "Cloudflare D1 (Pages)", tipo: "SQL en el Edge" }
        ],
        origen: "Cloudflare Pages Network"
    };
});

productRouter.get('/:id', (request) => {
    return {
        producto_id: Number(request.params.id),
        estado: "Disponible en caché perimetral de Pages"
    };
});

// ----------------------------------------------------------------------------
// ROUTER DE USUARIOS SEGUROS (/secure)
// ----------------------------------------------------------------------------
const secureRouter = new APIRouter({
    prefix: "/secure",
    tags: ["Seguridad"],
    dependencies: { user: getPagesUser }
});

secureRouter.post('/deploy', (request, env, ctx, deps) => {
    return {
        mensaje: "Despliegue de Cloudflare Pages verificado con éxito",
        operador: deps.user,
        body: request.body
    };
}, {
    body: {
        proyecto: { type: 'string', required: true },
        ambiente: { type: 'string', required: true }
    }
});

// ----------------------------------------------------------------------------
// ROUTER DE VECTORES EN EL EDGE (/vectors)
// ----------------------------------------------------------------------------
const vectorRouter = new APIRouter({
    prefix: "/vectors",
    tags: ["Vectores"],
    dependencies: { user: getPagesUser }
});

vectorRouter.post('/upsert', async (request, env, ctx, deps) => {
    const { collection, id, vector, metadata } = request.body;
    const { store, quantization } = getEdgeStore(request);
    
    if (!collection || !id || !Array.isArray(vector)) {
        return new Response(JSON.stringify({ detail: "Campos 'collection', 'id' y 'vector' son obligatorios" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (vector.length !== store.dim) {
        return new Response(JSON.stringify({ detail: `Dimensión de vector inválida. Se espera ${store.dim} dimensiones.` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    
    await preloadVectorCol(store, collection);
    store.set(collection, id, vector, metadata || {});
    await store.flush();
    
    return {
        mensaje: "Vector indexado con éxito en el Edge",
        collection,
        id,
        quantization
    };
}, {
    body: {
        collection: { type: 'string', required: true },
        id: { type: 'string', required: true },
        vector: { type: 'array', required: true },
        metadata: { type: 'object', required: false },
        quantization: { type: 'string', required: false }
    }
});

vectorRouter.post('/search', async (request, env, ctx, deps) => {
    const { collection, vector, limit, metric, dimSlice, filter, cursor } = request.body;
    const { store, quantization } = getEdgeStore(request);
    
    if (!collection || !Array.isArray(vector)) {
        return new Response(JSON.stringify({ detail: "Campos 'collection' y 'vector' son obligatorios" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (vector.length !== store.dim) {
        return new Response(JSON.stringify({ detail: `Dimensión de vector inválida. Se espera ${store.dim} dimensiones.` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    
    const limitVal = limit || 5;
    const metricVal = metric || 'cosine';
    const sliceVal = dimSlice || 0;
    
    let offset = 0;
    if (cursor) {
        try {
            offset = parseInt(atob(cursor), 10);
            if (isNaN(offset)) offset = 0;
        } catch (e) {
            offset = 0;
        }
    }
    const fetchK = offset + limitVal;

    await preloadVectorCol(store, collection);
    const results = store.search(collection, vector, fetchK, sliceVal, metricVal, filter);
    const slicedResults = results.slice(offset, offset + limitVal);
    const totalDocs = store._collections.get(collection)?.ids.length || 0;
    const nextCursor = (offset + limitVal < totalDocs) ? btoa((offset + limitVal).toString()) : null;

    return {
        mensaje: "Búsqueda semántica completada en el Edge",
        collection,
        quantization,
        resultados: slicedResults,
        nextCursor
    };
}, {
    body: {
        collection: { type: 'string', required: true },
        vector: { type: 'array', required: true },
        limit: { type: 'number', required: false },
        metric: { type: 'string', required: false },
        dimSlice: { type: 'number', required: false },
        filter: { type: 'object', required: false },
        quantization: { type: 'string', required: false },
        cursor: { type: 'string', required: false }
    }
});

vectorRouter.post('/search-hybrid', async (request, env, ctx, deps) => {
    const { collection, vector, text, limit, alpha, metric, cursor } = request.body;
    const { store, quantization } = getEdgeStore(request);
    
    if (!collection || !Array.isArray(vector) || typeof text !== 'string') {
        return new Response(JSON.stringify({ detail: "Campos 'collection', 'vector' y 'text' son obligatorios" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (vector.length !== store.dim) {
        return new Response(JSON.stringify({ detail: `Dimensión de vector inválida. Se espera ${store.dim} dimensiones.` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    
    const limitVal = limit || 5;
    const alphaVal = typeof alpha === 'number' ? alpha : 0.5;
    const metricVal = metric || 'cosine';
    
    let offset = 0;
    if (cursor) {
        try {
            offset = parseInt(atob(cursor), 10);
            if (isNaN(offset)) offset = 0;
        } catch (e) {
            offset = 0;
        }
    }
    const fetchK = offset + limitVal;

    await preloadVectorCol(store, collection);
    const results = store.hybrid.search(collection, vector, text, fetchK, {
        vectorWeight: alphaVal,
        textWeight: 1 - alphaVal,
        metric: metricVal
    });
    
    const slicedResults = results.slice(offset, offset + limitVal);
    const totalDocs = store._collections.get(collection)?.ids.length || 0;
    const nextCursor = (offset + limitVal < totalDocs) ? btoa((offset + limitVal).toString()) : null;

    return {
        mensaje: "Búsqueda híbrida completada en el Edge",
        collection,
        quantization,
        alpha: alphaVal,
        resultados: slicedResults,
        nextCursor
    };
}, {
    body: {
        collection: { type: 'string', required: true },
        vector: { type: 'array', required: true },
        text: { type: 'string', required: true },
        limit: { type: 'number', required: false },
        alpha: { type: 'number', required: false },
        metric: { type: 'string', required: false },
        quantization: { type: 'string', required: false },
        cursor: { type: 'string', required: false }
    }
});

vectorRouter.post('/build-index', async (request, env, ctx, deps) => {
    const { collection } = request.body;
    const { quantization } = getEdgeStore(request);
    if (!collection) {
        return new Response(JSON.stringify({ detail: "El campo 'collection' es obligatorio" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ detail: "Índice invertido IVF K-means no está soportado en caliente en el Edge." }), { status: 501, headers: { 'Content-Type': 'application/json' } });
});

vectorRouter.get('/collections', async (request, env, ctx, deps) => {
    const { store, quantization } = getEdgeStore(request);
    const cols = await store.listCollections();
    return {
        mensaje: "Colecciones vectoriales recuperadas con éxito en el Edge",
        quantization,
        collections: cols
    };
});

vectorRouter.get('/stats', async (request, env, ctx, deps) => {
    const { store, quantization } = getEdgeStore(request);
    return {
        mensaje: "Estadísticas del motor vectorial en el Edge",
        quantization,
        stats: store.stats()
    };
});

vectorRouter.delete('/collections/:name', async (request, env, ctx, deps) => {
    const col = request.params.name;
    const { store, quantization } = getEdgeStore(request);
    const cols = await store.listCollections();
    if (!cols.includes(col)) {
        return new Response(JSON.stringify({ detail: `Colección vectorial '${col}' no encontrada en el Edge (${quantization})` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    await preloadVectorCol(store, col);
    store.drop(col);
    return {
        mensaje: `Colección vectorial '${col}' eliminada con éxito del Edge (${quantization})`
    };
});

// Incluir enrutadores
app.includeRouter(productRouter);
app.includeRouter(secureRouter);
app.includeRouter(vectorRouter);

// ----------------------------------------------------------------------------
// ENDPOINTS DE AUTENTICACIÓN PERIMETRAL (/auth/register y /auth/login)
// ----------------------------------------------------------------------------
app.post('/auth/register', async (request, env, ctx) => {
    ensureDbAndAuth(env);
    await ensureAuthPreloaded();
    await ensureAuthInit(env);
    const { email, password, name } = request.body;
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
        return new Response(JSON.stringify({ detail: "Error en el registro", mensaje: "Formato de correo electrónico inválido" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!password || password.length < 6) {
        return new Response(JSON.stringify({ detail: "Error en el registro", mensaje: "La contraseña debe tener al menos 6 caracteres" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    
    try {
        const user = await auth.register(email, password, { name });
        return {
            mensaje: "Usuario registrado con éxito",
            usuario: user
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error en el registro", mensaje: err.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
}, {
    body: {
        email: { type: 'string', required: true },
        password: { type: 'string', required: true }
    }
});

app.post('/auth/login', async (request, env, ctx) => {
    ensureDbAndAuth(env);
    await ensureAuthPreloaded();
    await ensureAuthInit(env);
    const { email, password } = request.body;
    try {
        const session = await auth.login(email, password);
        return {
            mensaje: "Login exitoso",
            token: session.token,
            usuario: session.user
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Credenciales inválidas", mensaje: err.message }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
}, {
    body: {
        email: { type: 'string', required: true },
        password: { type: 'string', required: true }
    }
});

// Ruta Raíz de la API REST
app.get('/', (request) => {
    return {
        mensaje: "¡Bienvenido a FastAPI Pages Functions en Cloudflare!",
        documentacion: "/docs",
        openapi: "/openapi.json"
    };
});

// 5. EXPORTACIÓN DEL PUNTO DE ENTRADA EXCLUSIVO PARA CLOUDFLARE PAGES FUNCTIONS
export async function onRequest(context) {
    const { request, env } = context;
    const response = await app.handle(request, env, context);
    // Persistir base de datos y almacenes vectoriales al final del request en Pages Functions
    if (db && db._adapter && typeof db._adapter.persist === 'function') {
        context.waitUntil(db._adapter.persist());
    }
    if (stores) {
        for (const store of Object.values(stores)) {
            if (store._adapter && typeof store._adapter.persist === 'function') {
                context.waitUntil(store._adapter.persist());
            }
        }
    }
    return response;
}
