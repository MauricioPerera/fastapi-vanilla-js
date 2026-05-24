// Configurar PORT en 0 antes de importar index.js para que el servidor local de prueba 
// se vincule a un puerto aleatorio libre, evitando cualquier conflicto de dirección en uso (EADDRINUSE).
process.env.PORT = '0';

// Redireccionar console.log permanentemente a process.stderr para no contaminar stdout.
// MCP en modo stdio es sumamente estricto: stdout debe contener ÚNICAMENTE mensajes JSON-RPC válidos,
// mientras que stderr puede contener cualquier log o mensaje de diagnóstico sin afectar el protocolo.
// Dado que FastMCP utiliza directamente process.stdout.write para emitir sus respuestas JSON-RPC,
// redirigir console.log permanentemente a stderr es la solución más robusta y segura contra logs asíncronos.
console.log = (...args) => {
    process.stderr.write(args.join(' ') + '\n');
};

const { FastMCP } = require('./lib/fastmcp');
const { registerSystemFeatures } = require('./lib/mcp-features');
const { bridgeFastApiToMcp } = require('./lib/mcp-fastapi-bridge');
const app = require('./index');

// Inicializar Servidor MCP
const mcp = new FastMCP("FastMCP-API-Toolkit", {
    version: "2.0.0"
});

// 1. Registrar recursos, herramientas y prompts manuales del sistema
registerSystemFeatures(mcp);

// 2. Registrar automáticamente todos los endpoints de FastAPI como herramientas MCP
bridgeFastApiToMcp(app, mcp);

// Arrancar el Servidor stdio
mcp.start();
