const fs = require('fs');
const path = require('path');
const vectorDb = require('../dependencies/vector');
const db = require('../dependencies/db');

/**
 * Registra los recursos, herramientas y prompts del sistema en una instancia de FastMCP.
 * @param {FastMCP} mcp - Instancia del servidor de Model Context Protocol.
 */
function registerSystemFeatures(mcp) {
    _registerSystemResources(mcp);
    _registerSystemTools(mcp);
    _registerSystemPrompts(mcp);
}

function _registerSystemResources(mcp) {
    // ============================================================================
    // 1. RECURSOS DEL SISTEMA
    // ============================================================================

    // Recurso 1: Estado Físico del Sistema
    mcp.resource(
        "sistema://estado",
        "Estado Operativo del Sistema",
        "Provee información sobre la versión del motor de ejecución, memoria reservada e hilos de procesamiento.",
        "application/json",
        async () => {
            return {
                plataforma: process.platform,
                node_version: process.version,
                memoria_rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
                uptime: `${process.uptime().toFixed(1)} segundos`,
                pid: process.pid
            };
        }
    );

    // Recurso 2: Colecciones de Vectores
    mcp.resource(
        "vectores://colecciones",
        "Colecciones de Vectores Persistentes",
        "Retorna un JSON estructurado con información detallada de todas las colecciones vectoriales del sistema local, agrupadas por su tipo de cuantización.",
        "application/json",
        async () => {
            await vectorDb.initCrypto();
            const report = {};
            const types = ["float32", "int8", "binary", "polar"];
            for (const q of types) {
                const store = vectorDb.getStore(q);
                const cols = await store.listCollections();
                const colDetails = [];
                for (const col of cols) {
                    if (store._adapter && typeof store._adapter.preload === 'function') {
                        const jsonFile = store._jsonFile(col);
                        const binFile = store._binFile(col);
                        await store._adapter.preload([jsonFile, binFile]);
                    }
                    colDetails.push({
                        nombre: col,
                        documentos: store.count ? store.count(col) : 0,
                        dimension: store.dim
                    });
                }
                report[q] = colDetails;
            }
            return report;
        }
    );

    // Recurso 3: Colecciones de Documentos JSON
    mcp.resource(
        "documentos://colecciones",
        "Colecciones de Documentos JSON Estructurados",
        "Retorna un listado de todas las colecciones del Document Store local y el total de registros e índices en cada una.",
        "application/json",
        async () => {
            const colNames = db.collections();
            const report = {};
            for (const name of colNames) {
                const col = db.collection(name);
                report[name] = {
                    registros: col.count(),
                    indices: col.getIndexes()
                };
            }
            return report;
        }
    );

}

function _registerSystemTools(mcp) {
    // ============================================================================
    // 2. HERRAMIENTAS EXPOSIBLES
    // ============================================================================

    // Herramienta 1: Obtener Métricas Físicas del Sistema
    mcp.tool(
        "obtener_metricas",
        "Obtiene estadísticas en tiempo real del uso de recursos del servidor Node.js.",
        {
            type: "object",
            properties: {}
        },
        async () => {
            const usage = process.memoryUsage();
            return {
                mensaje: "Métricas leídas exitosamente",
                sistema: {
                    arquitectura: process.arch,
                    plataforma: process.platform,
                    tiempo_activo: `${process.uptime().toFixed(1)} segundos`
                },
                memoria: {
                    rss: `${(usage.rss / 1024 / 1024).toFixed(2)} MB`,
                    heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
                    heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`
                }
            };
        }
    );

    // Herramienta 2: Guardar Log de Auditoría Localmente (Con protección Directory Traversal real y dinámica)
    mcp.tool(
        "guardar_log",
        "Escribe de forma segura un mensaje en el archivo local de auditoría del proyecto.",
        {
            type: "object",
            properties: {
                evento: { type: "string", description: "Nombre de la acción u evento" },
                detalles: { type: "string", description: "Detalles adicionales del log" },
                archivo: { type: "string", description: "Nombre opcional del archivo de logs, por defecto 'audit.log'. Ej: 'seguridad.log'" }
            },
            required: ["evento", "detalles"]
        },
        async (args) => {
            const logDir = path.resolve(process.cwd(), '.logs');
            const fileName = args.archivo || 'audit.log';
            const logFile = path.join(logDir, fileName);

            // Crear carpeta de logs si no existe
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir);
            }

            // Evitar Directory Traversal verificando que el logfile esté contenido dentro del logDir resoluto
            const resolvedLogFile = path.resolve(logFile);
            const resolvedLogDir = path.resolve(logDir);

            if (!resolvedLogFile.startsWith(resolvedLogDir)) {
                throw new Error("Intento de Directory Traversal bloqueado.");
            }

            const logLine = `[${new Date().toISOString()}] EVENTO: ${args.evento} | DETALLES: ${args.detalles}\n`;
            
            await fs.promises.appendFile(resolvedLogFile, logLine, 'utf8');
            
            return {
                estado: "GUARDADO",
                mensaje: `Entrada de auditoría registrada exitosamente en el archivo local '${fileName}'.`,
                ruta_log: path.join('.logs', fileName).replace(/\\/g, '/')
            };
        }
    );

    // Herramienta 3: Consultar Estado del Servidor FastAPI Local (Reactividad de servicios)
    mcp.tool(
        "consultar_estado_api",
        "Realiza una petición de diagnóstico para verificar si el servidor FastAPI (REST API) en el puerto 8000 está activo.",
        {
            type: "object",
            properties: {
                puerto: { type: "number", description: "Puerto local del servidor REST, por defecto 8000" }
            }
        },
        async (args) => {
            const port = args.puerto || 8000;
            const targetUrl = `http://localhost:${port}/`;
            
            try {
                const start = Date.now();
                const res = await fetch(targetUrl);
                const duration = Date.now() - start;
                
                if (res.status === 200) {
                    const data = await res.json();
                    return {
                        estado: "ACTIVO",
                        mensaje: `El servidor FastAPI REST está corriendo perfectamente en el puerto ${port}.`,
                        latencia: `${duration}ms`,
                        respuesta_servidor: data
                    };
                } else {
                    return {
                        estado: "ANÓMALO",
                        mensaje: `El servidor REST respondió con un código de estado inesperado: ${res.status}.`
                    };
                }
            } catch (e) {
                return {
                    estado: "INACTIVO",
                    mensaje: `No se pudo establecer conexión con el servidor REST en ${targetUrl}. Asegúrate de iniciarlo con 'node index.js'.`,
                    error: e.message
                };
            }
        }
    );

    // Herramienta 4: Listar Colecciones de Vectores Locales
    mcp.tool(
        "list_vector_collections",
        "Obtiene la lista de todas las colecciones vectoriales activas registradas en el almacén local.",
        {
            type: "object",
            properties: {
                quantization: {
                    type: "string",
                    description: "Variante de cuantización: 'float32', 'int8', 'binary', 'polar'. Por defecto 'float32'",
                    enum: ["float32", "int8", "binary", "polar"],
                    required: false
                }
            }
        },
        async (args) => {
            const q = args.quantization || 'float32';
            const store = vectorDb.getStore(q);
            await vectorDb.initCrypto();
            const cols = await store.listCollections();
            const details = [];
            for (const col of cols) {
                if (store._adapter && typeof store._adapter.preload === 'function') {
                    const jsonFile = store._jsonFile(col);
                    const binFile = store._binFile(col);
                    await store._adapter.preload([jsonFile, binFile]);
                }
                const docCount = store.count ? store.count(col) : 0;
                details.push({
                    nombre: col,
                    documentos: docCount,
                    dimension: store.dim
                });
            }
            return {
                estado: "EXITOSO",
                cuantizacion: q,
                colecciones: details
            };
        }
    );

    // Herramienta 5: Insertar/Upsert de Vectores Locales
    mcp.tool(
        "vector_upsert",
        "Inserta o actualiza un vector numérico denso con metadatos asociados en el almacén de vectores persistente.",
        {
            type: "object",
            properties: {
                collection: { type: "string", description: "Nombre de la colección destino" },
                id: { type: "string", description: "Identificador único para el vector" },
                vector: {
                    type: "array",
                    items: { type: "number" },
                    description: "Array numérico que representa el embedding (dimensión 768)"
                },
                metadata: { type: "object", description: "Metadatos opcionales estructurados", required: false },
                quantization: {
                    type: "string",
                    description: "Variante de cuantización: 'float32', 'int8', 'binary', 'polar'. Por defecto 'float32'",
                    enum: ["float32", "int8", "binary", "polar"],
                    required: false
                }
            },
            required: ["collection", "id", "vector"]
        },
        async (args) => {
            const q = args.quantization || 'float32';
            const store = vectorDb.getStore(q);
            if (args.vector.length !== store.dim) {
                throw new Error(`Dimensión de vector inválida. Se esperaba ${store.dim} dimensiones, se recibió ${args.vector.length}.`);
            }
            await vectorDb.initCrypto();
            if (store._adapter && typeof store._adapter.preload === 'function') {
                const jsonFile = store._jsonFile(args.collection);
                const binFile = store._binFile(args.collection);
                await store._adapter.preload([jsonFile, binFile]);
            }
            store.set(args.collection, args.id, args.vector, args.metadata || {});
            await store.flush();
            if (store._adapter && typeof store._adapter.persist === 'function') {
                await store._adapter.persist();
            }
            return {
                estado: "EXITOSO",
                mensaje: `Vector '${args.id}' indexado y guardado correctamente en la colección '${args.collection}' (${q}).`,
                collection: args.collection,
                id: args.id
            };
        }
    );

    // Herramienta 6: Consultar/Búsqueda de Vectores Híbrida y Semántica
    mcp.tool(
        "vector_search",
        "Realiza búsquedas semánticas o híbridas (embeddings + BM25 léxico) sobre colecciones de vectores locales.",
        {
            type: "object",
            properties: {
                collection: { type: "string", description: "Nombre de la colección a consultar" },
                vector: {
                    type: "array",
                    items: { type: "number" },
                    description: "Vector numérico de consulta (dimensión 768)"
                },
                query_text: { type: "string", description: "Texto léxico para búsqueda híbrida (si se omite, se realiza búsqueda semántica pura)", required: false },
                limit: { type: "number", description: "Número de resultados a recuperar, por defecto 5", required: false },
                alpha: {
                    type: "number",
                    description: "Coeficiente híbrido: 1.0 para semántica pura, 0.0 para BM25 puro. Por defecto 0.5",
                    required: false
                },
                metric: {
                    type: "string",
                    description: "Métrica de distancia: 'cosine', 'euclidean', 'manhattan'. Por defecto 'cosine'",
                    enum: ["cosine", "euclidean", "manhattan"],
                    required: false
                },
                quantization: {
                    type: "string",
                    description: "Variante de cuantización a consultar: 'float32', 'int8', 'binary', 'polar'. Por defecto 'float32'",
                    enum: ["float32", "int8", "binary", "polar"],
                    required: false
                }
            },
            required: ["collection", "vector"]
        },
        async (args) => {
            const q = args.quantization || 'float32';
            const store = vectorDb.getStore(q);
            if (args.vector.length !== store.dim) {
                throw new Error(`Dimensión de vector de consulta inválida. Se esperaba ${store.dim} dimensiones.`);
            }
            await vectorDb.initCrypto();
            if (store._adapter && typeof store._adapter.preload === 'function') {
                const jsonFile = store._jsonFile(args.collection);
                const binFile = store._binFile(args.collection);
                await store._adapter.preload([jsonFile, binFile]);
            }
            const limitVal = args.limit || 5;
            const alphaVal = typeof args.alpha === 'number' ? args.alpha : 0.5;
            const metricVal = args.metric || 'cosine';

            let results;
            if (alphaVal === 1.0 || !args.query_text) {
                results = store.search(args.collection, args.vector, limitVal, 0, metricVal);
            } else {
                results = store.hybrid.search(args.collection, args.vector, args.query_text, limitVal, {
                    vectorWeight: alphaVal,
                    textWeight: 1 - alphaVal,
                    metric: metricVal
                });
            }
            return {
                estado: "EXITOSO",
                resultados: results
            };
        }
    );

    // Herramienta 7: Insertar Documentos Estructurados JSON
    mcp.tool(
        "document_insert",
        "Inserta un documento estructurado JSON en una colección del almacén de documentos persistente (DocStore) local.",
        {
            type: "object",
            properties: {
                collection: { type: "string", description: "Nombre de la colección de documentos" },
                document: { type: "object", description: "Objeto JSON conteniendo el documento a guardar. Si no tiene '_id', se generará uno automáticamente." }
            },
            required: ["collection", "document"]
        },
        async (args) => {
            const col = db.collection(args.collection);
            const inserted = col.insert(args.document);
            col.flush();
            return {
                estado: "EXITOSO",
                mensaje: `Documento insertado correctamente en la colección de documentos '${args.collection}'.`,
                documento: inserted
            };
        }
    );

    // Herramienta 8: Consultar/Buscar Documentos Estructurados
    mcp.tool(
        "document_find",
        "Realiza búsquedas filtradas, ordenaciones y saltos sobre la base de datos de documentos persistente (DocStore) local.",
        {
            type: "object",
            properties: {
                collection: { type: "string", description: "Nombre de la colección a consultar" },
                filter: { type: "object", description: "Objeto de filtro JSON estructurado (ej: { categoria: 'noticias' }, { edad: { $gte: 18 } })", required: false },
                sort: { type: "object", description: "Criterios de ordenación (ej: { fecha: -1 }, { nombre: 1 })", required: false },
                limit: { type: "number", description: "Cantidad máxima de registros a recuperar", required: false },
                skip: { type: "number", description: "Cantidad de registros a omitir para paginación", required: false }
            },
            required: ["collection"]
        },
        async (args) => {
            const col = db.collection(args.collection);
            let cursor = col.find(args.filter || {});
            if (args.sort) cursor = cursor.sort(args.sort);
            if (typeof args.skip === 'number') cursor = cursor.skip(args.skip);
            if (typeof args.limit === 'number') cursor = cursor.limit(args.limit);
            
            const docs = cursor.toArray();
            return {
                estado: "EXITOSO",
                conteo: docs.length,
                documentos: docs
            };
        }
    );

}

function _registerSystemPrompts(mcp) {
    // ============================================================================
    // 3. PLANTILLAS DE PROMPTS CONTEXTUALES
    // ============================================================================

    // Prompt 1: Explicar MCP
    mcp.prompt(
        "explicar_mcp",
        "Genera una guía rápida explicando el Model Context Protocol para un desarrollador.",
        [],
        async () => {
            return `Hola Desarrollador! 
Aquí tienes un resumen de cómo funciona el Model Context Protocol (MCP) en este servidor:
1. **Herramientas de Sistema**: Puedes llamar a 'obtener_metricas' o 'guardar_log' para interactuar con mi entorno físico de Node.js.
2. **Herramientas de Base de Datos**: Puedes interactuar con la DB mediante 'list_vector_collections', 'vector_upsert', 'vector_search', 'document_insert' y 'document_find'.
3. **Recursos**: Puedes leer 'sistema://estado', 'vectores://colecciones' y 'documentos://colecciones' para ver el estado de RAM y las colecciones en tiempo real.
4. **API Híbrida**: Puedes ejecutar 'consultar_estado_api' para comprobar si la REST API nativa en el puerto 8000 está activa.

¡Estoy a tu disposición para ayudarte a explorar este ecosistema híbrido!`;
        }
    );

    // Prompt 2: Guía de Análisis Semántico
    mcp.prompt(
        "analisis_semantico",
        "Obtén directrices y flujos estructurados para realizar búsquedas e indexación semántica/híbrida con embeddings.",
        [],
        async () => {
            return `Flujo de Trabajo para Análisis Semántico y Búsqueda Híbrida:
1. **Identificación**: Utiliza el recurso 'vectores://colecciones' para descubrir qué colecciones existen y su configuración.
2. **Vectorización**: Si posees embeddings correspondientes a tu texto de consulta (768 dimensiones), utilízalos directamente en la herramienta 'vector_search'.
3. **Búsqueda Híbrida**: Combina semántica y léxica usando 'vector_search' con los argumentos 'vector', 'query_text' y un factor de fusión 'alpha' (ej: 0.5 para balance equilibrado).
4. **Persistencia**: Si deseas registrar un nuevo elemento, llama a 'vector_upsert' y paralelamente guarda los metadatos completos en 'document_insert' para consultas estructuradas posteriores.`;
        }
    );
}

module.exports = {
    registerSystemFeatures
};
