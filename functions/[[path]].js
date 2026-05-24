import { FastAPI, APIRouter } from '../lib/fastapi-edge.js';
import { DocStore, MemoryStorageAdapter, CloudflareKVAdapter, Auth } from '../lib/js-doc-store.js';

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

// 3. Resolver de Dependencia de Seguridad en Pages Functions con base de datos real
const getPagesUser = async (request, env, ctx) => {
    await ensureAuthInit(env);
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error("Unauthorized");
    }
    const token = authHeader.split(' ')[1];
    
    // Bypass de desarrollo para tests retrocompatibles
    if (token === 'pages-secret-token') {
        return { username: "pages_operator", role: "admin" };
    }

    const payload = await auth.verify(token);
    if (!payload) {
        throw new Error("Forbidden");
    }
    return auth.getUser(payload.sub);
};

// 4. Manejo de Excepciones del Edge
app.addExceptionHandler(Error, (request, err, env, ctx) => {
    let status = 500;
    let detail = "Internal Pages Functions Error";
    
    if (err.message === "Unauthorized") {
        status = 401;
        detail = "No autorizado en Cloudflare Pages Functions";
    } else if (err.message === "Forbidden") {
        status = 403;
        detail = "Acceso prohibido en Cloudflare Pages Functions";
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
            { id: 701, nombre: "Cloudflare Pages", tipo: "Alojamiento estático global" },
            { id: 702, nombre: "Cloudflare Functions", tipo: "Serverless Edge Functions" }
        ],
        origen: "Cloudflare Pages Network"
    };
});

productRouter.get('/:id', (request) => {
    return {
        producto_id: Number(request.params.id),
        estado: "Servido en tiempo real desde el Edge de Cloudflare"
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

// Incluir enrutadores
app.includeRouter(productRouter);
app.includeRouter(secureRouter);

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
    // Redirigir el control completo de la petición a nuestro framework FastAPI Edge
    return await app.handle(request, env, context);
}
