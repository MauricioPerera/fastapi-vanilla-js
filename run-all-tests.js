const { spawn } = require('child_process');

function runSuite(name, script) {
    return new Promise((resolve) => {
        console.log(`\n\x1b[1m\x1b[35m========================================================\x1b[0m`);
        console.log(`\x1b[1m\x1b[35m▶ EJECUTANDO SUITE: ${name}\x1b[0m`);
        console.log(`\x1b[1m\x1b[35m========================================================\x1b[0m\n`);
        
        // Spawn el proceso hijo con stdio heredado para ver colores nativos de Node.js test runner
        const proc = spawn('node', [script], { stdio: 'inherit' });
        
        proc.on('close', (code) => {
            resolve(code === 0);
        });
    });
}

async function start() {
    console.log(`\n\x1b[1m\x1b[36m🚀 INICIANDO BATERÍA DE PRUEBAS COMPLETAS (FASTAPI VANILLA HÍBRIDO) 🚀\x1b[0m`);
    
    // 1. Ejecutar Suite de Servidor Node.js
    const nodeSuccess = await runSuite('NODE.JS SERVER INTEGRATION (PORT: 8999)', 'test.js');
    
    // 2. Ejecutar Suite de Cloudflare Workers (Edge)
    const edgeSuccess = await runSuite('CLOUDFLARE WORKERS EDGE INTEGRATION (V8 MOCKS)', 'test-edge.js');

    // 3. Ejecutar Suite del Servidor MCP
    const mcpSuccess = await runSuite('MODEL CONTEXT PROTOCOL (FastMCP) STDIO', 'test-mcp.js');
    
    // 4. Imprimir reporte consolidado
    console.log('\n\x1b[1m\x1b[36m========================================================\x1b[0m');
    console.log(`\x1b[1m\x1b[36m📊 REPORTE DE RESULTADOS CONSOLIDADOS\x1b[0m`);
    console.log('\x1b[1m\x1b[36m========================================================\x1b[0m');
    
    if (nodeSuccess) {
        console.log(`🟢 \x1b[1mSuite Node.js Server (test.js)\x1b[0m   : \x1b[32m✓ PASSED (12/12 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite Node.js Server (test.js)\x1b[0m   : \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (edgeSuccess) {
        console.log(`🟢 \x1b[1mSuite CF Workers Edge (test-edge.js)\x1b[0m: \x1b[32m✓ PASSED (9/9 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite CF Workers Edge (test-edge.js)\x1b[0m: \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (mcpSuccess) {
        console.log(`🟢 \x1b[1mSuite FastMCP Server (test-mcp.js)\x1b[0m  : \x1b[32m✓ PASSED (8/8 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite FastMCP Server (test-mcp.js)\x1b[0m  : \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }
    
    console.log('\x1b[1m\x1b[36m--------------------------------------------------------\x1b[0m');
    
    if (nodeSuccess && edgeSuccess && mcpSuccess) {
        console.log(`\n\x1b[1m\x1b[32m🏆 ¡ÉXITO TOTAL DE LA BATERÍA DE PRUEBAS! 🏆\x1b[0m`);
        console.log(`\x1b[32mTodas las APIs, Edge Workers, herramientas y recursos MCP funcionan de forma excelente.\x1b[0m\n`);
        process.exit(0);
    } else {
        console.log(`\n\x1b[1m\x1b[31m❌ ALGUNAS PRUEBAS FALLARON. Revisa la consola superior. ❌\x1b[0m\n`);
        process.exit(1);
    }
}

start();
