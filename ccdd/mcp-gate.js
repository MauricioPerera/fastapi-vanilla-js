#!/usr/bin/env node
/**
 * ccdd/mcp-gate.js — gate de APTITUD de la superficie MCP. PURO JS, ZERO-DEP.
 *
 * Vuelca el OpenAPI que ya genera la app y lo pasa por el gate estructural AACS (aacs-lite.js).
 * Si el bridge produce una superficie 1:1 inapta (demasiadas tools, formas idénticas, opcionales
 * libres), falla el build con los findings concretos. Sin Python, sin dependencias.
 *
 * Uso (CI):  PORT=0 npm run mcp:gate     (exit 0 = PASS, 1 = FAIL)
 */
process.env.PORT = process.env.PORT || '0'; // no colisionar con un server real
const { gate, toolsFromOpenAPI } = require('./aacs-lite');
const app = require('../index.js');

// El require de ../index.js arranca app.listen -> el socket mantiene vivo el event loop.
// Si _getOpenAPISchema() colgara, el proceso nunca terminaría en CI: timeout de respaldo.
const timeout = setTimeout(() => {
    console.error('mcp-gate error: timeout esperando el OpenAPI (10s).');
    process.exit(3);
}, 10000);

app._getOpenAPISchema().then((spec) => {
    clearTimeout(timeout);
    const r = gate(toolsFromOpenAPI(spec, true)); // filterSystem: como hace el bridge real
    const ok = r.verdict === 'PASS';
    console.log(`\n[${ok ? 'OK' : 'X'}] AACS gate sobre la superficie MCP: ${r.verdict}  (${r.tools} tools / ${r.entities} entidades)`);
    for (const f of r.findings) {
        let line = `     ${f.rule}: ${f.msg}`;
        if (f.pairs) line += ` -> ${f.pairs.slice(0, 8).join('; ')}${f.pairs.length > 8 ? ` (+${f.pairs.length - 8} más)` : ''}`;
        if (f.tools) line += ` -> ${f.tools.join(', ')}`;
        console.log(line);
    }
    if (!ok) console.log('     -> superficie 1:1 inapta; agrupá task-oriented (CRUD->find/upsert/remove, search_* unificado con mode).');
    process.exit(ok ? 0 : 1);
}).catch((e) => {
    clearTimeout(timeout);
    console.error('mcp-gate error:', e.message);
    process.exit(2);
});
