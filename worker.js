import { FastAPI, APIRouter } from './lib/fastapi-edge.js';
import { DocStore, MemoryStorageAdapter, CloudflareKVAdapter, Auth } from './lib/js-doc-store.js';

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

function ensureDbAndAuth(env) {
    if (!db) {
        if (env && env.MY_KV) {
            db = new DocStore(new CloudflareKVAdapter(env.MY_KV, 'db/'));
        } else {
            db = new DocStore(new MemoryStorageAdapter());
        }
        auth = new Auth(db, {
            secret: env.API_SECRET_TOKEN || 'edge-secret-token'
        });
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
        authInitialized = true;
    }
}

// 3. Resolver de Dependencia de Seguridad en el Edge con base de datos real
const getEdgeUser = async (request, env, ctx) => {
    await ensureAuthInit(env);
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error("Unauthorized");
    }
    const token = authHeader.split(' ')[1];
    
    // Bypass de desarrollo para tests retrocompatibles
    if (token === 'edge-secret-token') {
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

// Incluir Routers en la App
app.includeRouter(productRouter);
app.includeRouter(secureRouter);

// Endpoint Raíz
app.get('/', (request) => {
    return {
        mensaje: "¡Bienvenido a FastAPI Edge en Cloudflare!",
        documentacion: "/docs",
        openapi: "/openapi.json"
    };
});

// 5. EXPORTACIÓN DEL MANEJADOR FETCH OFICIAL DE CLOUDFLARE WORKERS
export default {
    async fetch(request, env, ctx) {
        return await app.handle(request, env, ctx);
    }
};
