const { APIRouter } = require('../lib/fastapi');
const { getCurrentUser } = require('../dependencies/auth');
const vectorDb = require('../dependencies/vector');
const { IVFIndex } = require('../lib/js-vector-store');

// Instancias de IVFIndex dedicadas para cada variante de almacén
const ivfIndexes = {
    float32: new IVFIndex(vectorDb.stores.float32),
    int8: new IVFIndex(vectorDb.stores.int8),
    binary: new IVFIndex(vectorDb.stores.binary),
    polar: new IVFIndex(vectorDb.stores.polar)
};
const getIvfIndex = (type) => ivfIndexes[type] || ivfIndexes.float32;

const vectorRouter = new APIRouter({
    prefix: '/vectors',
    tags: ['Vectores'],
    dependencies: { user: getCurrentUser }
});

// Helper para extraer la cuantización y resolver el almacén correspondiente
const getStoreAndIndex = (req) => {
    const q = req.body?.quantization || req.query?.quantization || 'float32';
    const quantization = ['float32', 'int8', 'binary', 'polar'].includes(q) ? q : 'float32';
    return {
        store: vectorDb.getStore(quantization),
        idx: getIvfIndex(quantization),
        quantization
    };
};

// Helper asíncrono para asegurar la inicialización de la clave y precarga de archivos cifrados en el cache
const ensureCryptoAndLoaded = async (store, collection) => {
    await vectorDb.initCrypto();
    if (store._adapter && typeof store._adapter.preload === 'function' && collection) {
        const jsonFile = store._jsonFile(collection);
        const binFile = store._binFile(collection);
        await store._adapter.preload([jsonFile, binFile]);
    }
};

// Valida dimensión y finitud del vector. Devuelve el mensaje de error o null si es válido.
const validateVectorValues = (vector, store) => {
    if (vector.length !== store.dim) {
        return `Dimensión de vector inválida. Se espera ${store.dim} dimensiones.`;
    }
    if (!vector.every(v => typeof v === 'number' && Number.isFinite(v))) {
        return "El vector debe contener solo números finitos";
    }
    return null;
};

// Decodifica el cursor base64 a un offset entero; 0 ante cualquier valor inválido.
const parseCursorOffset = (cursor) => {
    if (!cursor) return 0;
    try {
        const offset = parseInt(atob(cursor), 10);
        return (isNaN(offset) || offset < 0) ? 0 : offset;
    } catch (e) {
        return 0;
    }
};

// Calcula el cursor de la siguiente página, o null si no hay más resultados.
const buildNextCursor = (slicedLen, offset, limitVal, totalDocs) =>
    (slicedLen === limitVal && offset + limitVal < totalDocs) ? btoa((offset + limitVal).toString()) : null;

// 1. Upsert de Vectores
vectorRouter.post('/upsert', async (req, res, deps) => {
    const { collection, id, vector, metadata } = req.body;
    const { store, quantization } = getStoreAndIndex(req);

    if (!collection || !id || !Array.isArray(vector)) {
        return res.json({ detail: "Campos 'collection', 'id' y 'vector' son obligatorios" }, 400);
    }
    const vErr = validateVectorValues(vector, store);
    if (vErr) return res.json({ detail: vErr }, 400);

    await ensureCryptoAndLoaded(store, collection);
    store.set(collection, id, vector, metadata || {});
    
    try {
        store.flush();
        if (store._adapter && typeof store._adapter.persist === 'function') {
            await store._adapter.persist();
        }
    } catch (err) {
        return res.json({ detail: "Error al persistir el vector en disco", mensaje: err.message }, 500);
    }
    
    return {
        mensaje: "Vector indexado con éxito",
        collection,
        id,
        quantization,
        usuario: deps.user.email || deps.user.username
    };
}, {
    summary: "Indexar Vector",
    body: {
        collection: { type: 'string', required: true },
        id: { type: 'string', required: true },
        vector: { type: 'array', required: true },
        metadata: { type: 'object', required: false },
        quantization: { type: 'string', required: false }
    }
});

// 2. Búsqueda Semántica
vectorRouter.post('/search', async (req, res, deps) => {
    const { collection, vector, limit, metric, dimSlice, filter, cursor } = req.body;
    const { store, idx, quantization } = getStoreAndIndex(req);

    if (!collection || !Array.isArray(vector)) {
        return res.json({ detail: "Campos 'collection' y 'vector' son obligatorios" }, 400);
    }
    const vErr = validateVectorValues(vector, store);
    if (vErr) return res.json({ detail: vErr }, 400);

    const limitVal = limit || 5;
    const metricVal = metric || 'cosine';
    const sliceVal = dimSlice || 0;

    const offset = parseCursorOffset(cursor);
    const fetchK = offset + limitVal;
    
    await ensureCryptoAndLoaded(store, collection);
    
    let results;
    if (idx.hasIndex(collection)) {
        // Restaurar numProbes si se encuentra en los metadatos cargados
        const idxData = idx._loadIndex(collection);
        if (idxData && idxData.numProbes) {
            idx.numProbes = idxData.numProbes;
        }
        results = idx.search(collection, vector, fetchK);
    } else {
        results = store.search(collection, vector, fetchK, sliceVal, metricVal, filter);
    }

    const slicedResults = results.slice(offset, offset + limitVal);
    const totalDocs = store.count(collection);
    const nextCursor = buildNextCursor(slicedResults.length, offset, limitVal, totalDocs);

    return {
        mensaje: "Búsqueda semántica completada",
        collection,
        quantization,
        resultados: slicedResults,
        nextCursor
    };
}, {
    summary: "Búsqueda Semántica",
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

// 2.5 Búsqueda Híbrida (Dense Vector + Sparse BM25)
vectorRouter.post('/search-hybrid', async (req, res, deps) => {
    const { collection, vector, text, limit, alpha, metric, cursor } = req.body;
    const { store, quantization } = getStoreAndIndex(req);

    if (!collection || !Array.isArray(vector) || typeof text !== 'string') {
        return res.json({ detail: "Campos 'collection', 'vector' y 'text' son obligatorios" }, 400);
    }
    const vErr = validateVectorValues(vector, store);
    if (vErr) return res.json({ detail: vErr }, 400);

    const limitVal = limit || 5;
    const alphaVal = typeof alpha === 'number' ? alpha : 0.5;
    const metricVal = metric || 'cosine';

    const offset = parseCursorOffset(cursor);
    const fetchK = offset + limitVal;
    
    await ensureCryptoAndLoaded(store, collection);
    
    const results = store.hybrid.search(collection, vector, text, fetchK, {
        vectorWeight: alphaVal,
        textWeight: 1 - alphaVal,
        metric: metricVal
    });

    const slicedResults = results.slice(offset, offset + limitVal);
    const totalDocs = store.count(collection);
    const nextCursor = buildNextCursor(slicedResults.length, offset, limitVal, totalDocs);

    return {
        mensaje: "Búsqueda híbrida completada",
        collection,
        quantization,
        alpha: alphaVal,
        resultados: slicedResults,
        nextCursor
    };
}, {
    summary: "Búsqueda Híbrida",
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

// 3. Búsqueda Dimensional Matryoshka
vectorRouter.post('/search-matryoshka', async (req, res, deps) => {
    const { collection, vector, limit, stages, metric } = req.body;
    const { store, quantization } = getStoreAndIndex(req);

    if (!collection || !Array.isArray(vector) || !Array.isArray(stages)) {
        return res.json({ detail: "Campos 'collection', 'vector' y 'stages' son obligatorios" }, 400);
    }
    if (vector.length !== store.dim) {
        return res.json({ detail: `Dimensión de vector de consulta inválida. Se espera ${store.dim} dimensiones.` }, 400);
    }
    
    await ensureCryptoAndLoaded(store, collection);
    const results = store.matryoshkaSearch(collection, vector, limit || 5, stages, metric || 'cosine');
    return {
        mensaje: "Búsqueda dimensional Matryoshka completada",
        collection,
        quantization,
        resultados: results
    };
}, {
    summary: "Búsqueda Matryoshka",
    body: {
        collection: { type: 'string', required: true },
        vector: { type: 'array', required: true },
        stages: { type: 'array', required: true },
        limit: { type: 'number', required: false },
        metric: { type: 'string', required: false },
        quantization: { type: 'string', required: false }
    }
});

// 4. Búsqueda Cross-Collection con Normalización
vectorRouter.post('/search-across', async (req, res, deps) => {
    const { collections, vector, limit, metric } = req.body;
    const { store, quantization } = getStoreAndIndex(req);

    if (!Array.isArray(collections) || !Array.isArray(vector)) {
        return res.json({ detail: "Campos 'collections' y 'vector' son obligatorios" }, 400);
    }
    if (vector.length !== store.dim) {
        return res.json({ detail: `Dimensión de vector inválida. Se espera ${store.dim} dimensiones.` }, 400);
    }
    
    await ensureCryptoAndLoaded(store, null);
    for (const col of collections) {
        if (store._adapter && typeof store._adapter.preload === 'function') {
            await store._adapter.preload([store._jsonFile(col), store._binFile(col)]);
        }
    }
    
    const results = store.searchAcross(collections, vector, limit || 5, metric || 'cosine');
    return {
        mensaje: "Búsqueda cross-collection con normalización completada",
        colecciones: collections,
        quantization,
        resultados: results
    };
}, {
    summary: "Búsqueda Cross-Collection",
    body: {
        collections: { type: 'array', required: true },
        vector: { type: 'array', required: true },
        limit: { type: 'number', required: false },
        metric: { type: 'string', required: false },
        quantization: { type: 'string', required: false }
    }
});

// 5. Construcción de Índice IVF K-means
vectorRouter.post('/build-index', async (req, res, deps) => {
    const { collection, numClusters, numProbes } = req.body;
    const { store, idx, quantization } = getStoreAndIndex(req);

    if (!collection) {
        return res.json({ detail: "El campo 'collection' es obligatorio" }, 400);
    }
    
    await ensureCryptoAndLoaded(store, collection);
    const count = store.count(collection);
    const k = numClusters || Math.max(2, Math.round(Math.sqrt(count)));
    const p = numProbes || Math.max(1, Math.round(k * 0.2));
    
    idx.numClusters = k;
    idx.numProbes = p;
    idx.build(collection);
    
    return {
        mensaje: "Índice invertido IVF K-means construido con éxito",
        collection,
        quantization,
        clusters: k,
        probes: p
    };
}, {
    summary: "Construir Índice IVF",
    body: {
        collection: { type: 'string', required: true },
        numClusters: { type: 'number', required: false },
        numProbes: { type: 'number', required: false },
        quantization: { type: 'string', required: false }
    }
});

// 6. Listar Colecciones Vectoriales
vectorRouter.get('/collections', async (req, res, deps) => {
    const { store, quantization } = getStoreAndIndex(req);
    await ensureCryptoAndLoaded(store, null);
    const cols = await store.listCollections();
    return {
        mensaje: "Colecciones vectoriales recuperadas con éxito",
        quantization,
        collections: cols
    };
}, {
    summary: "Listar Colecciones Vectoriales"
});

// 7. Estadísticas del Almacén Vectorial
vectorRouter.get('/stats', async (req, res, deps) => {
    const { store, quantization } = getStoreAndIndex(req);
    await ensureCryptoAndLoaded(store, null);
    return {
        mensaje: "Estadísticas del motor vectorial",
        quantization,
        stats: store.stats()
    };
}, {
    summary: "Métricas del Motor Vectorial"
});

// 8. Eliminar Colección Vectorial
vectorRouter.delete('/collections/:name', async (req, res, deps) => {
    const col = req.params.name;
    const { store, quantization } = getStoreAndIndex(req);
    await ensureCryptoAndLoaded(store, col);
    const cols = await store.listCollections();
    if (!cols.includes(col)) {
        return res.json({ detail: `Colección vectorial '${col}' no encontrada en el almacén (${quantization})` }, 404);
    }
    store.drop(col);
    return {
        mensaje: `Colección vectorial '${col}' eliminada con éxito del almacén (${quantization})`
    };
}, {
    summary: "Eliminar Colección Vectorial"
});

module.exports = vectorRouter;
