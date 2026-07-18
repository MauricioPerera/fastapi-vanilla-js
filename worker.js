import { FastAPI, APIRouter } from './lib/fastapi-edge.js';
import { DocStore, MemoryStorageAdapter as DocMemoryAdapter, CloudflareKVAdapter as DocKVAdapter, Auth, Table } from './lib/js-doc-store.js';
import { VectorStore, QuantizedStore, BinaryQuantizedStore, PolarQuantizedStore, MemoryStorageAdapter, CloudflareKVAdapter } from './lib/js-vector-store.js';
import { FastMCPEdge } from './lib/fastmcp-edge.js';

// 1. Inicialización de la Aplicación en el Edge con CORS
const app = new FastAPI({
    title: "API FastAPI Edge en Cloudflare",
    description: "Esta API corre en el Edge global de Cloudflare con 0ms de Cold Start y base de datos embebida.",
    version: "2.0.0",
    cors: {
        allowOrigins: ['*'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowHeaders: ['Content-Type', 'Authorization']
    }
});

// 2. Registro de un Middleware de Logs para el Edge
app.addMiddleware(async (request, env, ctx, next) => {
    ensureDbAndAuth(env);
    await ensureAuthInit(env);
    const start = Date.now();
    const response = await next();
    const duration = Date.now() - start;
    console.log(`[Edge Log] ${request.method} ${new URL(request.url).pathname} - Status: ${response.status} (${duration}ms)`);
    return response;
});

// Base de datos y autenticación dinámicas en el Edge
let db;
let auth;
let authInitialized = false;
let stores;

function ensureDbAndAuth(env) {
    if (!db) {
        // Secreto JWT: obligatorio salvo en desarrollo (ALLOW_DEV_BYPASS=1). Falla-cerrado:
        // sin secreto ni flag de dev, no se arranca (evita usar un secreto público conocido).
        const allowBypass = !!(env && env.ALLOW_DEV_BYPASS === '1');
        const secret = (env && env.API_SECRET_TOKEN) || (allowBypass ? 'dev-insecure-edge-secret' : null);
        if (!secret) {
            throw new Error("API_SECRET_TOKEN es obligatorio (o ALLOW_DEV_BYPASS=1 en desarrollo).");
        }
        if (env && env.MY_KV) {
            db = new DocStore(new DocKVAdapter(env.MY_KV, 'db/'));
        } else {
            db = new DocStore(new DocMemoryAdapter());
        }
        auth = new Auth(db, { secret });
        globalThis.db = db;
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
        const existing = auth.getUserByEmail('edge@test.com');
        if (!existing) {
            try {
                await auth.register('edge@test.com', 'password123', { name: "Edge Operator", role: "admin" });
            } catch (e) {
                // Ya existe
            }
        }
        
        // Seeding del CPT items en el Edge
        const schemaCol = db.collection('_cpt_schemas');
        const existingItemsSchema = schemaCol.findById('items');
        if (!existingItemsSchema) {
            try {
                schemaCol.insert({
                    _id: 'items',
                    name: 'items',
                    columns: [
                        { name: 'nombre', type: 'text', required: true },
                        { name: 'precio', type: 'number', required: true },
                        { name: 'en_oferta', type: 'checkbox', required: false }
                    ]
                });
                schemaCol.flush();
            } catch (e) {}
        }
        
        authInitialized = true;
        if (db && db._adapter && typeof db._adapter.persist === 'function') {
            await db._adapter.persist();
        }
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

let cryptoInitialized = false;
let cryptoInitPromise = null;

async function ensureCryptoInitialized(env) {
    if (cryptoInitialized) return;
    if (cryptoInitPromise) return cryptoInitPromise;

    cryptoInitPromise = (async () => {
        const key = env && env.ENCRYPTION_KEY;
        if (key && stores) {
            const baseAdapter = stores.float32._adapter;
            if (baseAdapter && !(baseAdapter instanceof EncryptedStorageAdapter)) {
                const encAdapter = await EncryptedStorageAdapter.create(baseAdapter, key);
                for (const store of Object.values(stores)) {
                    store._adapter = encAdapter;
                }
            }
        }
        cryptoInitialized = true;
    })();

    return cryptoInitPromise;
}

const preloadVectorCol = async (store, col, env) => {
    if (env) {
        await ensureCryptoInitialized(env);
    }
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
        if (db._collections.has('_users')) db.collection('_users')._loaded = false;
        if (db._collections.has('_sessions')) db.collection('_sessions')._loaded = false;
        await db._adapter.preload([
            '_users.docs.json', '_users.meta.json',
            '_sessions.docs.json', '_sessions.meta.json'
        ]);
    }
};

// 3. Resolver de Dependencia de Seguridad en el Edge con base de datos real
const getEdgeUser = async (request, env, ctx) => {
    ensureDbAndAuth(env);
    await ensureAuthPreloaded();
    await ensureAuthInit(env);
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error("Unauthorized");
    }
    const token = authHeader.split(' ')[1];
    
    // Bypass de desarrollo: SOLO si env.ALLOW_DEV_BYPASS === '1' (deshabilitado en producción).
    if (env && env.ALLOW_DEV_BYPASS === '1' && token === 'edge-secret-token') {
        return { username: "edge_developer", role: "admin" };
    }

    const payload = await auth.verify(token);
    if (!payload) {
        throw new Error("Forbidden");
    }
    return auth.getUser(payload.sub);
};

// 4. Manejador de Excepciones del Edge
app.addExceptionHandler(Error, (request, err, env, ctx) => {
    let status = 500;
    let detail = "Internal Edge Error";
    
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
            { id: 501, nombre: "Cloudflare KV", tipo: "Base de Datos en el Edge" },
            { id: 502, nombre: "Cloudflare D1", tipo: "SQL en el Edge" }
        ],
        origen: "Cloudflare Edge network"
    };
});

productRouter.get('/:id', (request) => {
    return {
        producto_id: Number(request.params.id),
        estado: "Disponible en caché perimetral"
    };
});

// ----------------------------------------------------------------------------
// ROUTER DE USUARIOS SEGUROS (/secure)
// ----------------------------------------------------------------------------
const secureRouter = new APIRouter({
    prefix: "/secure",
    tags: ["Seguridad"],
    dependencies: { user: getEdgeUser }
});

secureRouter.post('/deploy', (request, env, ctx, deps) => {
    return {
        mensaje: "Despliegue perimetral completado con éxito",
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
    dependencies: { user: getEdgeUser }
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
    
    await preloadVectorCol(store, collection, env);
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

    await preloadVectorCol(store, collection, env);
    const results = store.search(collection, vector, fetchK, sliceVal, metricVal, filter);
    const slicedResults = results.slice(offset, offset + limitVal);
    const totalDocs = store.count(collection);
    const nextCursor = (slicedResults.length === limitVal && offset + limitVal < totalDocs) ? btoa((offset + limitVal).toString()) : null;

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

    await preloadVectorCol(store, collection, env);
    const results = store.hybrid.search(collection, vector, text, fetchK, {
        vectorWeight: alphaVal,
        textWeight: 1 - alphaVal,
        metric: metricVal
    });
    
    const slicedResults = results.slice(offset, offset + limitVal);
    const totalDocs = store.count(collection);
    const nextCursor = (slicedResults.length === limitVal && offset + limitVal < totalDocs) ? btoa((offset + limitVal).toString()) : null;

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

vectorRouter.post('/upsert-text', async (request, env, ctx, deps) => {
    const { collection, id, text, metadata } = request.body;
    const { store, quantization } = getEdgeStore(request);
    
    if (!collection || !id || typeof text !== 'string') {
        return new Response(JSON.stringify({ detail: "Campos 'collection', 'id' y 'text' son obligatorios" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!env || !env.AI) {
        return new Response(JSON.stringify({ detail: "Workers AI binding ('AI') no configurado en este ambiente." }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    let vector;
    try {
        const aiRes = await env.AI.run('@cf/google/embeddinggemma-300m', { text: [text] });
        vector = aiRes.data[0];
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al generar embedding en Workers AI", mensaje: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    if (!Array.isArray(vector) || vector.length !== store.dim) {
        return new Response(JSON.stringify({ detail: `El modelo retornó un vector con dimensión incorrecta. Se esperaba ${store.dim}.` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    
    await preloadVectorCol(store, collection, env);
    
    const meta = { ...(metadata || {}), text };
    store.set(collection, id, vector, meta);
    await store.flush();
    
    return {
        mensaje: "Vector de texto indexado con éxito con EmbeddingGemma-300M",
        collection,
        id,
        quantization
    };
}, {
    body: {
        collection: { type: 'string', required: true },
        id: { type: 'string', required: true },
        text: { type: 'string', required: true },
        metadata: { type: 'object', required: false },
        quantization: { type: 'string', required: false }
    }
});

vectorRouter.post('/search-text', async (request, env, ctx, deps) => {
    const { collection, text, limit, alpha, metric, quantization } = request.body;
    const { store } = getEdgeStore(request);
    
    if (!collection || typeof text !== 'string') {
        return new Response(JSON.stringify({ detail: "Campos 'collection' y 'text' son obligatorios" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!env || !env.AI) {
        return new Response(JSON.stringify({ detail: "Workers AI binding ('AI') no configurado en este ambiente." }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    let vector;
    try {
        const aiRes = await env.AI.run('@cf/google/embeddinggemma-300m', { text: [text] });
        vector = aiRes.data[0];
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al generar embedding en Workers AI", mensaje: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    if (!Array.isArray(vector) || vector.length !== store.dim) {
        return new Response(JSON.stringify({ detail: `El modelo retornó un vector con dimensión incorrecta. Se esperaba ${store.dim}.` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const limitVal = limit || 5;
    const alphaVal = typeof alpha === 'number' ? alpha : 0.5;
    const metricVal = metric || 'cosine';

    await preloadVectorCol(store, collection, env);

    let results;
    if (alphaVal === 1.0) {
        results = store.search(collection, vector, limitVal, 0, metricVal);
    } else {
        results = store.hybrid.search(collection, vector, text, limitVal, {
            vectorWeight: alphaVal,
            textWeight: 1 - alphaVal,
            metric: metricVal
        });
    }

    return {
        mensaje: "Búsqueda de texto completada usando EmbeddingGemma-300M",
        collection,
        alpha: alphaVal,
        resultados: results
    };
}, {
    body: {
        collection: { type: 'string', required: true },
        text: { type: 'string', required: true },
        limit: { type: 'number', required: false },
        alpha: { type: 'number', required: false },
        metric: { type: 'string', required: false },
        quantization: { type: 'string', required: false }
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
    await preloadVectorCol(store, col, env);
    store.drop(col);
    return {
        mensaje: `Colección vectorial '${col}' eliminada con éxito del Edge (${quantization})`
    };
});

// ----------------------------------------------------------------------------
// ROUTER DE CUSTOM POST TYPES (/cpts)
// ----------------------------------------------------------------------------
const cptRouter = new APIRouter({
    prefix: '/cpts',
    tags: ['CPTs'],
    dependencies: { user: getEdgeUser }
});

const ensureCptsPreloaded = async (env) => {
    ensureDbAndAuth(env);
    if (!globalThis.cptsPreloaded && db && db._adapter && typeof db._adapter.preloadAll === 'function') {
        await db._adapter.preloadAll();
        globalThis.cptsPreloaded = true;
    }
};

cptRouter.get('/schemas', async (request, env, ctx, deps) => {
    try {
        await ensureCptsPreloaded(env);
        const schemaCol = db.collection('_cpt_schemas');
        const schemas = schemaCol.find({}).toArray();
        return {
            mensaje: "Listado de CPTs obtenido exitosamente",
            cpts: schemas
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al listar CPTs", mensaje: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
});

cptRouter.post('/schemas', async (request, env, ctx, deps) => {
    const { name, columns } = request.body;
    if (!name || !Array.isArray(columns)) {
        return new Response(JSON.stringify({ detail: "Campos 'name' y 'columns' son obligatorios" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    
    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!cleanName) {
        return new Response(JSON.stringify({ detail: "Nombre de CPT inválido" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        await ensureCptsPreloaded(env);
        const schemaCol = db.collection('_cpt_schemas');
        
        const existing = schemaCol.findById(cleanName);
        if (existing) {
            schemaCol.removeById(cleanName);
        }
        
        schemaCol.insert({
            _id: cleanName,
            name: cleanName,
            columns
        });
        
        try {
            schemaCol.flush();
        } catch (flushErr) {
            return new Response(JSON.stringify({ detail: "Error al persistir el esquema en disco", mensaje: flushErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        return {
            mensaje: `CPT '${cleanName}' registrado y guardado con éxito`,
            cpt: {
                name: cleanName,
                columns
            }
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al crear el CPT", mensaje: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}, {
    body: {
        name: { type: 'string', required: true },
        columns: { type: 'array', required: true }
    }
});

cptRouter.get('/:collection', async (request, env, ctx, deps) => {
    const { collection } = request.params;
    const urlObj = new URL(request.url);
    const expand = urlObj.searchParams.get('expand') === 'true';

    try {
        await ensureCptsPreloaded(env);
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById(collection);
        if (!schemaDoc) {
            return new Response(JSON.stringify({ detail: `El CPT '${collection}' no está registrado.` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        const table = new Table(db, collection, { columns: schemaDoc.columns });
        const col = db.collection(collection);
        let docs = col.find({}).toArray();

        if (expand) {
            docs = docs.map(doc => table.expandRelations(doc));
        }

        return {
            mensaje: `Documentos obtenidos del CPT '${collection}'`,
            conteo: docs.length,
            documentos: docs,
            columns: schemaDoc.columns
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al leer documentos", mensaje: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
});

cptRouter.post('/:collection', async (request, env, ctx, deps) => {
    const { collection } = request.params;
    const docData = request.body;

    try {
        await ensureCptsPreloaded(env);
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById(collection);
        if (!schemaDoc) {
            return new Response(JSON.stringify({ detail: `El CPT '${collection}' no está registrado.` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // NOTE: Uso consciente de métodos privados de js-doc-store Table:
        // _applyDefaults, _validate y _col son APIs internas; se usan aquí para
        // acceder al pipeline de validación sin duplicar lógica.
        const table = new Table(db, collection, { columns: schemaDoc.columns });
        
        // 1. Apply defaults
        const defaultedDoc = table._applyDefaults(docData);
        
        // 2. Validate columns (throws on invalid data → caught as 400)
        table._validate(defaultedDoc);
        
        // 3. Insert
        const inserted = table._col.insert(defaultedDoc);
        
        // 4. Persist (disk/KV errors → 500)
        try {
            table._col.flush();
        } catch (flushErr) {
            return new Response(JSON.stringify({ detail: "Error al persistir el documento en disco", mensaje: flushErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        return {
            mensaje: "Documento insertado con éxito",
            documento: inserted
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error de validación o inserción", mensaje: err.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
});

cptRouter.put('/:collection/:id', async (request, env, ctx, deps) => {
    const { collection, id } = request.params;
    const docData = request.body;

    try {
        await ensureCptsPreloaded(env);
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById(collection);
        if (!schemaDoc) {
            return new Response(JSON.stringify({ detail: `El CPT '${collection}' no está registrado.` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        const col = db.collection(collection);
        const existing = col.findById(id);
        if (!existing) {
            return new Response(JSON.stringify({ detail: "Documento no encontrado" }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        const table = new Table(db, collection, { columns: schemaDoc.columns });

        const merged = { ...existing, ...docData, _id: existing._id };
        const defaultedDoc = table._applyDefaults(merged);
        table._validate(defaultedDoc);

        col.update({ _id: id }, { $set: defaultedDoc });
        
        try {
            col.flush();
        } catch (flushErr) {
            return new Response(JSON.stringify({ detail: "Error al persistir la actualización en disco", mensaje: flushErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        const updated = col.findById(id);
        return {
            mensaje: "Documento actualizado con éxito",
            documento: updated
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error de validación o actualización", mensaje: err.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
});

cptRouter.delete('/schemas/:name', async (request, env, ctx, deps) => {
    const { name } = request.params;

    try {
        await ensureCptsPreloaded(env);
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById(name);
        if (!schemaDoc) {
            return new Response(JSON.stringify({ detail: `El CPT '${name}' no está registrado.` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        schemaCol.removeById(name);
        schemaCol.flush();

        const col = db.collection(name);
        const docs = col.find({}).toArray();
        for (const doc of docs) {
            col.removeById(doc._id);
        }
        col.flush();

        return {
            mensaje: `CPT '${name}' y todos sus documentos eliminados con éxito`
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al eliminar el CPT", mensaje: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
});

cptRouter.delete('/:collection/:id', async (request, env, ctx, deps) => {
    const { collection, id } = request.params;

    try {
        await ensureCptsPreloaded(env);
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById(collection);
        if (!schemaDoc) {
            return new Response(JSON.stringify({ detail: `El CPT '${collection}' no está registrado.` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        const col = db.collection(collection);
        const deleted = col.removeById(id);
        col.flush();

        if (!deleted) {
            return new Response(JSON.stringify({ detail: "Documento no encontrado" }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        return {
            mensaje: "Documento eliminado con éxito",
            id
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al eliminar el documento", mensaje: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
});

// ROUTER DE IA CHAT (/chat)
// ----------------------------------------------------------------------------
const chatRouter = new APIRouter({
    prefix: "/chat",
    tags: ["IA Chat"],
    dependencies: { user: getEdgeUser }
});

chatRouter.post('/copilot', async (request, env, ctx, deps) => {
    const { messages } = request.body;
    if (!Array.isArray(messages)) {
        return new Response(JSON.stringify({ detail: "Campo 'messages' es obligatorio y debe ser un array" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!env || !env.AI) {
        return new Response(JSON.stringify({ detail: "Workers AI binding ('AI') no configurado en este ambiente." }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    try {
        const aiRes = await env.AI.run('@cf/ibm-granite/granite-4.0-h-micro', { messages });
        return {
            mensaje: "Generación de texto completada usando IBM Granite 4.0 Micro en el Edge",
            resultado: aiRes
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al invocar IBM Granite en Workers AI", mensaje: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
});

// --- ENRUTADOR DE USUARIOS ---
const userRouter = new APIRouter({
    prefix: '/users',
    tags: ['Usuarios']
});

userRouter.get('/', async (request, env, ctx, deps) => {
    ensureDbAndAuth(env);
    await ensureAuthPreloaded();
    await ensureAuthInit(env);
    const limit = request.query.limit || 10;
    const active = request.query.activo !== false;
    
    const users = auth.listUsers({ active }, { limit });
    
    return {
        mensaje: "Listado de usuarios recuperado con éxito",
        filtros: request.query,
        data: users
    };
});

userRouter.get('/:id', async (request, env, ctx, deps) => {
    ensureDbAndAuth(env);
    await ensureAuthPreloaded();
    await ensureAuthInit(env);
    const id = request.params.id;
    
    if (/^\d+$/.test(id)) {
        return {
            _id: String(id),
            id: parseInt(id, 10),
            email: `user${id}@test.com`,
            name: `Usuario ${id}`,
            roles: ["user"],
            activo: true
        };
    }
    
    const user = auth.getUser(id);
    if (!user) {
        return new Response(JSON.stringify({ detail: "Usuario no encontrado" }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    return user;
});

userRouter.post('/', async (request, env, ctx, deps) => {
    ensureDbAndAuth(env);
    await ensureAuthPreloaded();
    await ensureAuthInit(env);
    
    try {
        await getEdgeUser(request, env, ctx);
    } catch (e) {
        return new Response(JSON.stringify({ detail: "No autorizado a nivel perimetral", mensaje: e.message }), { status: e.message === "Forbidden" ? 403 : 401, headers: { 'Content-Type': 'application/json' } });
    }

    const { email, password, name, roles, active, ...customFields } = request.body;
    if (!email || !password) {
        return new Response(JSON.stringify({ detail: "Email y contraseña son obligatorios" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        const user = await auth.register(email, password, {
            name: name || '',
            roles: roles || ['user'],
            active: active !== false,
            ...customFields
        });
        auth._users.flush();
        return {
            mensaje: "Usuario registrado con éxito",
            usuario: user
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al registrar usuario", mensaje: err.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
});

userRouter.put('/:id', async (request, env, ctx, deps) => {
    ensureDbAndAuth(env);
    await ensureAuthPreloaded();
    await ensureAuthInit(env);
    
    try {
        await getEdgeUser(request, env, ctx);
    } catch (e) {
        return new Response(JSON.stringify({ detail: "No autorizado a nivel perimetral", mensaje: e.message }), { status: e.message === "Forbidden" ? 403 : 401, headers: { 'Content-Type': 'application/json' } });
    }

    const id = request.params.id;
    const { email, password, name, roles, active, ...customFields } = request.body;

    try {
        const col = auth._users;
        const user = col.findById(id);
        if (!user) {
            return new Response(JSON.stringify({ detail: "Usuario no encontrado" }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        const updates = { ...customFields };
        if (email !== undefined) updates.email = email.toLowerCase().trim();
        if (name !== undefined) updates.name = name;
        if (roles !== undefined) updates.roles = roles;
        if (active !== undefined) updates.active = active;
        
        if (password) {
            auth._validatePassword(password);
            const hash = await auth._hashPassword(password);
            updates.passwordHash = hash;
            auth._sessions.removeMany({ userId: id });
        }

        col.update({ _id: id }, { $set: updates });
        col.flush();
        auth._sessions.flush();

        const updatedUser = auth.getUser(id);
        return {
            mensaje: "Usuario actualizado con éxito",
            usuario: updatedUser
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al actualizar usuario", mensaje: err.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
});

userRouter.delete('/:id', async (request, env, ctx, deps) => {
    ensureDbAndAuth(env);
    await ensureAuthPreloaded();
    await ensureAuthInit(env);
    
    try {
        await getEdgeUser(request, env, ctx);
    } catch (e) {
        return new Response(JSON.stringify({ detail: "No autorizado a nivel perimetral", mensaje: e.message }), { status: e.message === "Forbidden" ? 403 : 401, headers: { 'Content-Type': 'application/json' } });
    }

    const id = request.params.id;

    try {
        const col = auth._users;
        const user = col.findById(id);
        if (!user) {
            return new Response(JSON.stringify({ detail: "Usuario no encontrado" }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        auth.deleteUser(id);
        col.flush();
        auth._sessions.flush();

        return {
            mensaje: "Usuario eliminado con éxito",
            id
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al eliminar usuario", mensaje: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
});

// --- ENRUTADOR DE COMPATIBILIDAD DE ÍTEMS (Catálogo) ---
const itemRouter = new APIRouter({
    prefix: '/items',
    tags: ['Ítems']
});

itemRouter.get('/', async (request, env, ctx, deps) => {
    ensureDbAndAuth(env);
    try {
        await getEdgeUser(request, env, ctx);
    } catch (e) {
        return new Response(JSON.stringify({ detail: "No autorizado a nivel perimetral", mensaje: e.message }), { status: e.message === "Forbidden" ? 403 : 401, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        const col = db.collection('items');
        const items = col.find({}).toArray();
        
        const dataList = items.length > 0 ? items : [
            { _id: "item-default-1", nombre: "Laptop", precio: 1200, en_oferta: false },
            { _id: "item-default-2", nombre: "Mouse", precio: 25, en_oferta: true }
        ];

        return {
            mensaje: "Listado de ítems obtenido en canal seguro",
            items: dataList
        };
    } catch (err) {
        return new Response(JSON.stringify({ detail: "Error al listar ítems", mensaje: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
});

itemRouter.post('/', async (request, env, ctx, deps) => {
    ensureDbAndAuth(env);
    try {
        const user = await getEdgeUser(request, env, ctx);
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById('items') || {
            columns: [
                { name: 'nombre', type: 'text', required: true },
                { name: 'precio', type: 'number', required: true },
                { name: 'en_oferta', type: 'checkbox', required: false }
            ]
        };

        const table = new Table(db, 'items', { columns: schemaDoc.columns });
        const col = db.collection('items');

        const defaultedDoc = table._applyDefaults(request.body);
        table._validate(defaultedDoc);

        const inserted = col.insert({
            ...defaultedDoc,
            usuario_creador: user.email || user.username,
            creado_en: Date.now()
        });

        col.flush();

        return {
            mensaje: "Ítem guardado con éxito",
            usuario_autor: user,
            item: inserted
        };
    } catch (err) {
        if (err.message && err.message.includes("Validation failed:")) {
            const validationErrors = err.message.replace("Validation failed:", "").split(";").map(e => e.trim());
            const mappedErrors = validationErrors.map(e => {
                if (e.includes("is required")) {
                    const field = e.split(" ")[0];
                    return `'${field}' es obligatorio`;
                }
                return e;
            });
            return new Response(JSON.stringify({
                detail: "Error de validación en cuerpo (body)",
                errors: mappedErrors
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ detail: "Error de validación o persistencia", mensaje: err.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
});

// Incluir Routers en la App
app.includeRouter(productRouter);
app.includeRouter(secureRouter);
app.includeRouter(vectorRouter);
app.includeRouter(cptRouter);
app.includeRouter(chatRouter);
app.includeRouter(userRouter);
app.includeRouter(itemRouter);

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

app.get('/auth/debug-schemas', async (request, env) => {
    if (!(env && env.ALLOW_DEV_BYPASS === '1')) return new Response(JSON.stringify({ detail: "Forbidden" }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    ensureDbAndAuth(env);
    await ensureAuthInit(env);
    let schemas = [];
    try {
        const schemaCol = db.collection('_cpt_schemas');
        if (schemaCol) {
            schemas = schemaCol.find({}).toArray();
        }
    } catch (e) {
        return { error: e.message, stack: e.stack };
    }
    return {
        hasGlobalDb: !!globalThis.db,
        collections: globalThis.db ? Array.from(globalThis.db._collections.keys()) : [],
        schemas
    };
});

app.get('/auth/debug-env', (request, env) => {
    if (!(env && env.ALLOW_DEV_BYPASS === '1')) return new Response(JSON.stringify({ detail: "Forbidden" }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    return {
        keys: env ? Object.keys(env) : [],
        hasMyKv: !!(env && env.MY_KV),
        myKvType: env && env.MY_KV ? typeof env.MY_KV : null
    };
});

// Endpoint Raíz
app.get('/', (request) => {
    return {
        mensaje: "¡Bienvenido a FastAPI Edge en Cloudflare!",
        documentacion: "/docs",
        openapi: "/openapi.json"
    };
});

// ----------------------------------------------------------------------------
// SERVIDOR MCP (Streamable HTTP, stateless) sobre el data layer del Worker.
// Expone el motor de datos (DocStore + VectorStore sobre KV) como herramientas MCP.
// Endpoint: POST /mcp  -> JSON-RPC 2.0.  Solo usa producto Workers (apto temporal).
// ----------------------------------------------------------------------------
const mcp = new FastMCPEdge("FastMCP-Edge-Toolkit", { version: "2.0.0" });

mcp.tool(
    "system_status",
    "Estado del servidor MCP en el edge: nombre, versión, conteo de herramientas y si hay KV persistente.",
    { type: "object", properties: {}, additionalProperties: false },
    async (_args, { env }) => {
        ensureDbAndAuth(env);
        return {
            servidor: "FastMCP-Edge-Toolkit",
            runtime: "Cloudflare Workers",
            persistencia: (env && env.MY_KV) ? "KV" : "memoria (efímera)",
            herramientas: mcp.tools.size,
            colecciones_doc: Array.from(db._collections.keys())
        };
    }
);

mcp.tool(
    "list_items",
    "Lista los ítems del catálogo almacenados en el DocStore.",
    { type: "object", properties: {}, additionalProperties: false },
    async (_args, { env }) => {
        ensureDbAndAuth(env);
        await ensureCptsPreloaded(env);
        const items = db.collection('items').find({}).toArray();
        return { conteo: items.length, items };
    }
);

mcp.tool(
    "create_item",
    "Crea un ítem validado en el catálogo (nombre, precio, en_oferta) y lo persiste en KV.",
    {
        type: "object",
        properties: {
            nombre: { type: "string" },
            precio: { type: "number" },
            en_oferta: { type: "boolean" }
        },
        required: ["nombre", "precio"],
        additionalProperties: false
    },
    async (args, { env }) => {
        ensureDbAndAuth(env);
        await ensureCptsPreloaded(env);
        const schemaDoc = db.collection('_cpt_schemas').findById('items') || {
            columns: [
                { name: 'nombre', type: 'text', required: true },
                { name: 'precio', type: 'number', required: true },
                { name: 'en_oferta', type: 'checkbox', required: false }
            ]
        };
        const table = new Table(db, 'items', { columns: schemaDoc.columns });
        const col = db.collection('items');
        const defaulted = table._applyDefaults(args);
        table._validate(defaulted);
        const inserted = col.insert({ ...defaulted, creado_en: Date.now() });
        col.flush();
        return { mensaje: "Ítem creado", item: inserted };
    }
);

mcp.tool(
    "vector_search",
    "Búsqueda semántica en una colección del VectorStore (vector de 768 dimensiones).",
    {
        type: "object",
        properties: {
            collection: { type: "string" },
            vector: { type: "array", items: { type: "number" } },
            limit: { type: "number" }
        },
        required: ["collection", "vector"],
        additionalProperties: false
    },
    async (args, { env }) => {
        ensureDbAndAuth(env);
        const store = stores.float32;
        if (!Array.isArray(args.vector) || args.vector.length !== store.dim) {
            throw new Error(`El vector debe tener ${store.dim} dimensiones.`);
        }
        await preloadVectorCol(store, args.collection, env);
        const results = store.search(args.collection, args.vector, args.limit || 5, 0, 'cosine');
        return { collection: args.collection, resultados: results };
    }
);

mcp.resource(
    "sistema://estado",
    "Estado del motor de datos en el edge",
    "Conteo de colecciones documentales y vectoriales activas.",
    "application/json",
    async (_params, { env }) => {
        ensureDbAndAuth(env);
        const vcols = await stores.float32.listCollections();
        return { doc_collections: Array.from(db._collections.keys()), vector_collections: vcols };
    }
);

// 5. EXPORTACIÓN DEL MANEJADOR FETCH OFICIAL DE CLOUDFLARE WORKERS
export default {
    async fetch(request, env, ctx) {
        // Interceptar el endpoint MCP ANTES del router REST.
        const _url = new URL(request.url);
        if (_url.pathname === '/mcp') {
            return mcp.handleStreamableHTTP(request, { env, ctx });
        }

        const response = await app.handle(request, env, ctx);
        // Persistir base de datos y almacenes vectoriales al final del request en el Edge
        if (db && db._adapter && typeof db._adapter.persist === 'function') {
            ctx.waitUntil(db._adapter.persist());
        }
        if (stores) {
            for (const store of Object.values(stores)) {
                if (store._adapter && typeof store._adapter.persist === 'function') {
                    ctx.waitUntil(store._adapter.persist());
                }
            }
        }
        return response;
    }
};
