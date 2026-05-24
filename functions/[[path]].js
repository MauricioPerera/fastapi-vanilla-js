import { FastAPI, APIRouter } from '../lib/fastapi-edge.js';
import { DocStore, MemoryStorageAdapter, CloudflareKVAdapter, Auth } from '../lib/js-doc-store.js';
import { VectorStore, QuantizedStore, BinaryQuantizedStore, PolarQuantizedStore } from '../lib/js-vector-store.js';

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
            db = new DocStore(new CloudflareKVAdapter(env.MY_KV, 'db/'));
        } else {
            db = new DocStore(new MemoryStorageAdapter());
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

// Helper para extraer la cuantización y resolver el almacén correspondiente
const getEdgeStore = (req) => {
    const q = req.body?.quantization || 'float32';
    const quantization = ['float32', 'int8', 'binary', 'polar'].includes(q) ? q : 'float32';
    return {
        store: stores[quantization],
        quantization
    };
};

// 3. Dependency Resolver para Usuarios de Pages
const getPagesUser = async (request, env, ctx) => {
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
        return { detail: "Campos 'collection', 'id' y 'vector' son obligatorios", status_code: 400 };
    }
    if (vector.length !== store.dim) {
        return { detail: `Dimensión de vector inválida. Se espera ${store.dim} dimensiones.`, status_code: 400 };
    }
    
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
        vector: { type: 'array', required: true }
    }
});

vectorRouter.post('/search', async (request, env, ctx, deps) => {
    const { collection, vector, limit, metric, dimSlice, filter } = request.body;
    const { store, quantization } = getEdgeStore(request);
    
    if (!collection || !Array.isArray(vector)) {
        return { detail: "Campos 'collection' y 'vector' son obligatorios", status_code: 400 };
    }
    if (vector.length !== store.dim) {
        return { detail: `Dimensión de vector inválida. Se espera ${store.dim} dimensiones.`, status_code: 400 };
    }
    
    const limitVal = limit || 5;
    const metricVal = metric || 'cosine';
    const sliceVal = dimSlice || 0;
    
    const results = store.search(collection, vector, limitVal, sliceVal, metricVal, filter);
    return {
        mensaje: "Búsqueda semántica completada en el Edge",
        collection,
        quantization,
        resultados: results
    };
}, {
    body: {
        collection: { type: 'string', required: true },
        vector: { type: 'array', required: true }
    }
});

vectorRouter.post('/build-index', async (request, env, ctx, deps) => {
    const { collection } = request.body;
    const { quantization } = getEdgeStore(request);
    if (!collection) {
        return { detail: "El campo 'collection' es obligatorio", status_code: 400 };
    }
    return {
        mensaje: "Índice invertido IVF K-means simulado en el Edge",
        collection,
        quantization
    };
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
        return { detail: `Colección vectorial '${col}' no encontrada en el Edge (${quantization})`, status_code: 404 };
    }
    store.drop(col);
    return {
        mensaje: `Colección vectorial '${col}' eliminada con éxito del Edge (${quantization})`
    };
});

// Incluir enrutadores
app.includeRouter(productRouter);
app.includeRouter(secureRouter);
app.includeRouter(vectorRouter);

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
    return await app.handle(request, env, context);
}
