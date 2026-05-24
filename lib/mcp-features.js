const fs = require('fs');
const path = require('path');

/**
 * Registra los recursos, herramientas y prompts del sistema en una instancia de FastMCP.
 * @param {FastMCP} mcp - Instancia del servidor de Model Context Protocol.
 */
function registerSystemFeatures(mcp) {
    // ============================================================================
    // 1. RECURSO DEL SISTEMA (sistema://estado)
    // ============================================================================
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

    // ============================================================================
    // 3. PLANTILLA DE PROMPTS CONTEXTUALES
    // ============================================================================
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
}

module.exports = {
    registerSystemFeatures
};
