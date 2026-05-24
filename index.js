const { FastAPI } = require('./lib/fastapi');
const userRouter = require('./routers/users');
const itemRouter = require('./routers/items');
const { UnauthorizedError } = require('./dependencies/auth');
const path = require('path');
const fs = require('fs');

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
    console.log(`[${new Date().toISOString()}] \x1b[36m${req.method}\x1b[0m ${req.url} - Status: \x1b[32m${res.statusCode}\x1b[0m (${duration}ms)`);
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

// 4.5 Integración del Servidor Model Context Protocol (FastMCP) sobre HTTP/SSE
const { FastMCP } = require('./lib/fastmcp');
const mcp = new FastMCP("FastMCP-API-Toolkit-SSE", {
    version: "2.0.0"
});

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

mcp.tool(
    "guardar_log",
    "Escribe de forma segura un mensaje en el archivo local de auditoría del proyecto.",
    {
        type: "object",
        properties: {
            evento: { type: "string", description: "Nombre de la acción u evento" },
            detalles: { type: "string", description: "Detalles adicionales del log" }
        },
        required: ["evento", "detalles"]
    },
    async (args) => {
        const logDir = path.join(__dirname, '.logs');
        const logFile = path.join(logDir, 'audit.log');

        // Crear carpeta de logs si no existe
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir);
        }

        // Evitar Directory Traversal verificando que el logfile esté contenido dentro del logDir resoluto
        if (!path.resolve(logFile).startsWith(path.resolve(logDir))) {
            throw new Error("Intento de Directory Traversal bloqueado.");
        }

        const logLine = `[${new Date().toISOString()}] EVENTO: ${args.evento} | DETALLES: ${args.detalles}\n`;
        
        await fs.promises.appendFile(logFile, logLine, 'utf8');
        
        return {
            estado: "GUARDADO",
            mensaje: "Entrada de auditoría registrada exitosamente en el archivo local.",
            ruta_log: ".logs/audit.log"
        };
    }
);

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

mcp.prompt(
    "explicar_mcp",
    "Genera una guía rápida explicando el Model Context Protocol para un desarrollador.",
    [],
    async () => {
        return `Hola Desarrollador! 
Aquí tienes un resumen de cómo funciona el Model Context Protocol (MCP) en este servidor:
1. **Herramientas**: Puedes llamar a 'obtener_metricas' o 'guardar_log' para interactuar con mi entorno físico de Node.js.
2. **Recursos**: Puedes leer 'sistema://estado' para ver los recursos de RAM y procesos en tiempo real.
3. **API Híbrida**: Puedes ejecutar 'consultar_estado_api' para comprobar si la REST API nativa en el puerto 8000 está activa.

¡Estoy a tu disposición para ayudarte a explorar este ecosistema híbrido!`;
    }
);

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
