const { APIRouter } = require('../lib/fastapi');
const { getCurrentUser } = require('../dependencies/auth');
const vectorDb = require('../dependencies/vector');
const { IVFIndex } = require('../lib/js-vector-store');

// Instancia singleton compartida de IVFIndex
const ivfIndex = new IVFIndex(vectorDb);

const vectorRouter = new APIRouter({
    prefix: '/vectors',
    tags: ['Vectores'],
    dependencies: { user: getCurrentUser }
});

// 1. Upsert de Vectores
vectorRouter.post('/upsert', (req, res, deps) => {
    const { collection, id, vector, metadata } = req.body;
    if (!collection || !id || !Array.isArray(vector)) {
        return res.json({ detail: "Campos 'collection', 'id' y 'vector' son obligatorios" }, 400);
    }
    if (vector.length !== vectorDb.dim) {
        return res.json({ detail: `Dimensión de vector inválida. Se espera ${vectorDb.dim} dimensiones.` }, 400);
    }
    if (!vector.every(v => typeof v === 'number' && Number.isFinite(v))) {
        return res.json({ detail: "El vector debe contener solo números finitos" }, 400);
    }
    
    vectorDb.set(collection, id, vector, metadata || {});
    
    try {
        vectorDb.flush();
    } catch (err) {
        return res.json({ detail: "Error al persistir el vector en disco", mensaje: err.message }, 500);
    }
    
    return {
        mensaje: "Vector indexado con éxito",
        collection,
        id,
        usuario: deps.user.email || deps.user.username
    };
}, {
    summary: "Indexar Vector",
    body: {
        collection: { type: 'string', required: true },
        id: { type: 'string', required: true },
        vector: { type: 'array', required: true },
        metadata: { type: 'object', required: false }
    }
});

// 2. Búsqueda Semántica
vectorRouter.post('/search', (req, res, deps) => {
    const { collection, vector, limit, metric, dimSlice, filter } = req.body;
    if (!collection || !Array.isArray(vector)) {
        return res.json({ detail: "Campos 'collection' y 'vector' son obligatorios" }, 400);
    }
    if (vector.length !== vectorDb.dim) {
        return res.json({ detail: `Dimensión de vector inválida. Se espera ${vectorDb.dim} dimensiones.` }, 400);
    }
    if (!vector.every(v => typeof v === 'number' && Number.isFinite(v))) {
        return res.json({ detail: "El vector debe contener solo números finitos" }, 400);
    }
    
    const limitVal = limit || 5;
    const metricVal = metric || 'cosine';
    const sliceVal = dimSlice || 0;
    
    let results;
    if (ivfIndex.hasIndex(collection)) {
        const idxData = ivfIndex._loadIndex(collection);
        if (idxData && idxData.numProbes) {
            ivfIndex.numProbes = idxData.numProbes;
        }
        results = ivfIndex.search(collection, vector, limitVal);
    } else {
        results = vectorDb.search(collection, vector, limitVal, sliceVal, metricVal, filter);
    }
    
    return {
        mensaje: "Búsqueda semántica completada",
        collection,
        resultados: results
    };
}, {
    summary: "Búsqueda Semántica",
    body: {
        collection: { type: 'string', required: true },
        vector: { type: 'array', required: true },
        limit: { type: 'number', required: false },
        metric: { type: 'string', required: false },
        dimSlice: { type: 'number', required: false },
        filter: { type: 'object', required: false }
    }
});

// 3. Búsqueda Dimensional Matryoshka
vectorRouter.post('/search-matryoshka', (req, res, deps) => {
    const { collection, vector, limit, stages, metric } = req.body;
    if (!collection || !Array.isArray(vector) || !Array.isArray(stages)) {
        return res.json({ detail: "Campos 'collection', 'vector' y 'stages' son obligatorios" }, 400);
    }
    if (vector.length !== vectorDb.dim) {
        return res.json({ detail: `Dimensión de vector de consulta inválida. Se espera ${vectorDb.dim} dimensiones.` }, 400);
    }
    
    const results = vectorDb.matryoshkaSearch(collection, vector, limit || 5, stages, metric || 'cosine');
    return {
        mensaje: "Búsqueda dimensional Matryoshka completada",
        collection,
        resultados: results
    };
}, {
    summary: "Búsqueda Matryoshka",
    body: {
        collection: { type: 'string', required: true },
        vector: { type: 'array', required: true },
        stages: { type: 'array', required: true },
        limit: { type: 'number', required: false },
        metric: { type: 'string', required: false }
    }
});

// 4. Búsqueda Cross-Collection con Normalización
vectorRouter.post('/search-across', (req, res, deps) => {
    const { collections, vector, limit, metric } = req.body;
    if (!Array.isArray(collections) || !Array.isArray(vector)) {
        return res.json({ detail: "Campos 'collections' y 'vector' son obligatorios" }, 400);
    }
    if (vector.length !== vectorDb.dim) {
        return res.json({ detail: `Dimensión de vector inválida. Se espera ${vectorDb.dim} dimensiones.` }, 400);
    }
    
    const results = vectorDb.searchAcross(collections, vector, limit || 5, metric || 'cosine');
    return {
        mensaje: "Búsqueda cross-collection con normalización completada",
        colecciones: collections,
        resultados: results
    };
}, {
    summary: "Búsqueda Cross-Collection",
    body: {
        collections: { type: 'array', required: true },
        vector: { type: 'array', required: true },
        limit: { type: 'number', required: false },
        metric: { type: 'string', required: false }
    }
});

// 5. Construcción de Índice IVF K-means
vectorRouter.post('/build-index', (req, res, deps) => {
    const { collection, numClusters, numProbes } = req.body;
    if (!collection) {
        return res.json({ detail: "El campo 'collection' es obligatorio" }, 400);
    }
    
    const count = vectorDb.count(collection);
    
    // Configuración heurística inteligente de clusters (K ≈ sqrt(N))
    const k = numClusters || Math.max(2, Math.round(Math.sqrt(count)));
    const p = numProbes || Math.max(1, Math.round(k * 0.2));
    
    ivfIndex.numClusters = k;
    ivfIndex.numProbes = p;
    ivfIndex.build(collection);
    
    return {
        mensaje: "Índice invertido IVF K-means construido con éxito",
        collection,
        clusters: k,
        probes: p
    };
}, {
    summary: "Construir Índice IVF",
    body: {
        collection: { type: 'string', required: true },
        numClusters: { type: 'number', required: false },
        numProbes: { type: 'number', required: false }
    }
});

// 6. Listar Colecciones Vectoriales
vectorRouter.get('/collections', async (req, res, deps) => {
    const cols = await vectorDb.listCollections();
    return {
        mensaje: "Colecciones vectoriales recuperadas con éxito",
        collections: cols
    };
}, {
    summary: "Listar Colecciones Vectoriales"
});

// 7. Estadísticas del Almacén Vectorial
vectorRouter.get('/stats', (req, res, deps) => {
    return {
        mensaje: "Estadísticas del motor vectorial",
        stats: vectorDb.stats()
    };
}, {
    summary: "Métricas del Motor Vectorial"
});

// 8. Eliminar Colección Vectorial
vectorRouter.delete('/collections/:name', async (req, res, deps) => {
    const col = req.params.name;
    const cols = await vectorDb.listCollections();
    if (!cols.includes(col)) {
        return res.json({ detail: `Colección vectorial '${col}' no encontrada` }, 404);
    }
    vectorDb.drop(col);
    return {
        mensaje: `Colección vectorial '${col}' eliminada con éxito`
    };
}, {
    summary: "Eliminar Colección Vectorial"
});

module.exports = vectorRouter;
