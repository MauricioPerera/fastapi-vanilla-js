const { FastMCP } = require('./lib/fastmcp');
const { registerSystemFeatures } = require('./lib/mcp-features');

// Inicializar Servidor MCP
const mcp = new FastMCP("FastMCP-API-Toolkit", {
    version: "2.0.0"
});

// Registrar recursos, herramientas y prompts compartidos
registerSystemFeatures(mcp);

// Arrancar el Servidor stdio
mcp.start();
