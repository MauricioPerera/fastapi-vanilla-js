const { FastAPI } = require('./lib/fastapi');
const userRouter = require('./routers/users');
const itemRouter = require('./routers/items');
const vectorRouter = require('./routers/vectors');
const cptRouter = require('./routers/cpts');
const chatRouter = require('./routers/chat');
const reposRouter = require('./routers/repos');
const issuesRouter = require('./routers/issues');
const pullsRouter = require('./routers/pulls');
const actionsRouter = require('./routers/actions');
const postalRouter = require('./routers/postal');
const { UnauthorizedError } = require('./dependencies/auth');
const path = require('path');
const fs = require('fs');

// Marca de tiempo de arranque del proceso: base para el uptime del health-check.
const startedAt = Date.now();

// 1. Inicialización de la Aplicación con CORS
const app = new FastAPI({
    title: "API Modular de Producción Vanilla JS",
    description: "Microframework modular de alto rendimiento basado en Node.js nativo sin dependencias externas.",
    version: "2.0.0",
    cors: {
        allowOrigins: ['*'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowHeaders: ['Content-Type', 'Authorization']
    }
});

// 2. Registro de Middleware de Logging Global
app.addMiddleware(async (req, res, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    // Redacta el token si vino por query param (fallback SSE de navegador): nunca
    // loguear tokens. Los tokens por header Authorization no aparecen en req.url.
    const safeUrl = req.url.replace(/([?&])token=[^&]*/g, '$1token=<redacted>');
    // LOG_FORMAT=json activa el modo de salida JSON estructurada (una línea por
    // request, parseable por un colector de logs). SIN esa variable (default que
    // usan todos los tests), el logging es idéntico al texto coloreado de siempre.
    if (process.env.LOG_FORMAT === 'json') {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            method: req.method,
            path: safeUrl,
            status: res.statusCode,
            durationMs: duration
        }));
    } else {
        console.log(`[${new Date().toISOString()}] \x1b[36m${req.method}\x1b[0m ${safeUrl} - Status: \x1b[32m${res.statusCode}\x1b[0m (${duration}ms)`);
    }
});

// 3. Manejadores de Excepciones Globales
app.addExceptionHandler(UnauthorizedError, (req, res, err) => {
    if (!res.writableEnded) {
        res.json({ detail: "Acceso denegado a nivel global", mensaje: err.message }, 401);
    }
});

// 4. Inclusión de Routers Modulares
app.includeRouter(userRouter);
app.includeRouter(itemRouter);
app.includeRouter(vectorRouter);
app.includeRouter(cptRouter);
app.includeRouter(chatRouter);
app.includeRouter(reposRouter);
app.includeRouter(issuesRouter);
app.includeRouter(pullsRouter);
app.includeRouter(actionsRouter);
app.includeRouter(postalRouter);

// 4.1 Endpoints nativos de Autenticación con js-doc-store
const { auth, ensureAuthInit } = require('./dependencies/auth');

// Seed automático de datos en el arranque del servidor
async function seedDatabase() {
    await ensureAuthInit();
    const existingAdmin = auth.getUserByEmail('admin@test.com');
    if (!existingAdmin) {
        await auth.register('admin@test.com', 'password123', {
            name: "Admin User",
            roles: ["admin"]
        });
    }
    const db = require('./dependencies/db');
    const schemaCol = db.collection('_cpt_schemas');
    const existingItemsSchema = schemaCol.findById('items');
    if (!existingItemsSchema) {
        schemaCol.insert({
            _id: 'items',
            name: 'items',
            columns: [
                { name: 'nombre', type: 'text', required: true },
                { name: 'precio', type: 'number', required: true },
                { name: 'en_oferta', type: 'checkbox', required: false }
            ]
        });
        try {
            schemaCol.flush();
        } catch (e) {}
        console.log(`\n\x1b[32m✔ Base de datos inicializada: Se registró el CPT 'items' (Catálogo).\x1b[0m`);
    }

    const existingUser = auth.getUserByEmail('user@test.com');
    if (!existingUser) {
        await auth.register('user@test.com', 'password123', {
            name: "Standard User",
            roles: ["user"]
        });
        console.log(`\n\x1b[32m✔ Base de datos inicializada: Se registraron 'admin@test.com' y 'user@test.com'.\x1b[0m`);
    }
}
seedDatabase().catch(err => console.error("Error sembrando base de datos:", err));

app.post('/auth/register', async (req, res) => {
    await ensureAuthInit();
    const { email, password, name } = req.body;
    
    // Validaciones nativas y seguras de formato y longitud
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
        return res.json({ detail: "Error en el registro", mensaje: "Formato de correo electrónico inválido" }, 400);
    }
    if (!password || password.length < 6) {
        return res.json({ detail: "Error en el registro", mensaje: "La contraseña debe tener al menos 6 caracteres" }, 400);
    }
    
    try {
        const user = await auth.register(email, password, { name });
        return {
            mensaje: "Usuario registrado con éxito",
            usuario: user
        };
    } catch (err) {
        return res.json({ detail: "Error en el registro", mensaje: err.message }, 400);
    }
}, {
    summary: "Registrar Usuario",
    body: {
        email: { type: 'string', required: true },
        password: { type: 'string', required: true },
        name: { type: 'string', required: false }
    }
});

app.post('/auth/login', async (req, res) => {
    await ensureAuthInit();
    const { email, password } = req.body;
    try {
        const session = await auth.login(email, password);
        return {
            mensaje: "Login exitoso",
            token: session.token,
            usuario: session.user
        };
    } catch (err) {
        return res.json({ detail: "Credenciales inválidas", mensaje: err.message }, 401);
    }
}, {
    summary: "Iniciar Sesión",
    body: {
        email: { type: 'string', required: true },
        password: { type: 'string', required: true }
    }
});

// 4.5 Integración del Servidor Model Context Protocol (FastMCP) sobre HTTP/SSE
const { FastMCP } = require('./lib/fastmcp');
const { registerSystemFeatures } = require('./lib/mcp-features');
const { registerGitTools } = require('./lib/mcp-git-tools');
const { registerActionsPostalTools } = require('./lib/mcp-actions-postal-tools');

const mcp = new FastMCP("FastMCP-API-Toolkit-SSE", {
    version: "2.0.0"
});

// Registrar recursos, herramientas y prompts compartidos
registerSystemFeatures(mcp);

// Registrar tools adaptadoras de repos / issues / pull requests (MCP-TOOLS-PLAN.md)
registerGitTools(mcp);

// Registrar tools adaptadoras de actions / postal (MCP-TOOLS-PLAN.md, chunk B)
registerActionsPostalTools(mcp);

// Vincular los endpoints SSE de FastMCP en la instancia de nuestra API
mcp.setupSSE(app);

// 5. Endpoint Raíz
app.get('/', (req, res) => {
    return {
        mensaje: "¡Bienvenido a FastAPI Vanilla JS de Producción!",
        documentacion: "/docs",
        openapi: "/openapi.json",
        servidor_archivos_estaticos: "/static/index.html"
    };
}, {
    tags: ["Inicio"],
    summary: "Endpoint de Inicio"
});

// 5.1 Health Check (público, sin auth — health-check estándar)
// Devuelve el estado REAL del sistema: uptime, timestamp ISO y un check barato y
// real de la base de datos (Document Store). Si el check de db falla, responde 503
// con status "degraded" y el detalle de qué falló, en vez de un 200 mentiroso.
app.get('/health', (req, res) => {
    const checks = {};
    let failed = null;
    try {
        const db = require('./dependencies/db');
        // Operación barata y real: contar docs de una colección del Document Store.
        // Si el adapter/disco está roto, count() lanza y el check falla (db=false).
        const n = db.collection('_cpt_schemas').count();
        checks.db = typeof n === 'number';
    } catch (err) {
        checks.db = false;
        failed = { db: err.message };
    }
    const payload = {
        status: checks.db ? 'ok' : 'degraded',
        uptime: Math.round((Date.now() - startedAt) / 1000),
        timestamp: new Date().toISOString(),
        checks
    };
    if (failed) {
        payload.detail = failed;
        res.json(payload, 503);
        return;
    }
    return payload;
}, {
    tags: ["Salud"],
    summary: "Health Check del sistema"
});

// 6. Configuración y Servicio de Carpeta de Archivos Estáticos
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}
const htmlFilePath = path.join(publicDir, 'index.html');
if (!fs.existsSync(htmlFilePath)) {
    fs.writeFileSync(htmlFilePath, `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Archivos Estáticos Nativos</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f0f2f5; }
        .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; }
        h1 { color: #0070f3; margin-top: 0; }
        p { color: #555; }
    </style>
</head>
<body>
    <div class="card">
        <h1>¡Hola desde el Servidor de Archivos Estáticos Nativo!</h1>
        <p>Este archivo HTML se sirve directamente del disco duro local sin Express, Koa o Nginx.</p>
        <a href="/docs" style="color: #0070f3; text-decoration: none; font-weight: bold;">Ir a la documentación Swagger UI ➡</a>
    </div>
</body>
</html>`);
}

app.serveStatic('/static', publicDir);

// 7. Arranque del Servidor
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`\n\x1b[32m=== Servidor FastAPI Vanilla JS Encendido ===\x1b[0m`);
    console.log(`🔌 URL de Entrada:          http://localhost:${PORT}`);
    console.log(`📖 Swagger UI interactivo:  http://localhost:${PORT}/docs`);
    console.log(`📄 Especificación OpenAPI:  http://localhost:${PORT}/openapi.json`);
    console.log(`📁 Archivos Estáticos:      http://localhost:${PORT}/static/index.html`);
});

// Exportar la instancia app para testing
module.exports = app;
