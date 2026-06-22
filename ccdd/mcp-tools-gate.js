#!/usr/bin/env node
/**
 * ccdd/mcp-tools-gate.js — gate de APTITUD de la superficie MCP REAL (las 17 tools registradas).
 *
 * A diferencia de mcp-gate.js (que vuelca el OpenAPI REST y lo pasa 1:1 por el bridge), este gate
 * carga las tools MCP task-oriented tal como las registra el framework: hace un shim sobre
 * `mcp.tool(name, description, inputSchema, handler)` de lib/mcp-git-tools.js +
 * lib/mcp-actions-postal-tools.js, reconstruye cada inputSchema y los pasa por `gate()` de
 * aacs-lite.js. Mide la superficie que el modelo ve de verdad, NO el volcado REST legacy.
 *
 * No arranca ningun server: solo requiere los modulos de registro (sin side-effects de red) y
 * llama a sus funciones `registerX(mcp)` con un shim recolector.
 *
 * Uso (CI):  PORT=0 npm run mcp:gate:tools   (exit 0 = PASS, 1 = FAIL)
 */
'use strict';

const { gate } = require('./aacs-lite');
const { registerGitTools } = require('../lib/mcp-git-tools');
const { registerActionsPostalTools } = require('../lib/mcp-actions-postal-tools');

// Shim que imita la firma FastMCP.tool(name, description, inputSchema, handler) y recolecta
// las tools registradas sin ejecutar nada. No llama a los handlers (no abre sockets, no fs).
function captureMcp() {
    const captured = [];
    const shim = {
        tool(name, description, inputSchema /*, handler */) {
            captured.push({ name, description, inputSchema });
        },
        resource() {},
        prompt() {}
    };
    return { shim, captured };
}

// Entidad = prefijo antes del primer '_' (repos, issues, prs, actions, postal).
function entityOf(toolName) {
    const i = toolName.indexOf('_');
    return i > 0 ? toolName.slice(0, i) : toolName;
}

function loadTools() {
    const { shim, captured } = captureMcp();
    registerGitTools(shim);
    registerActionsPostalTools(shim);
    return captured.map((t) => ({
        id: t.name,
        entity: entityOf(t.name),
        inputSchema: t.inputSchema || { type: 'object', properties: {} }
    }));
}

function main() {
    const tools = loadTools();
    const r = gate(tools);
    const ok = r.verdict === 'PASS';
    console.log(`\n[${ok ? 'OK' : 'X'}] AACS gate sobre la superficie MCP REAL: ${r.verdict}  (${r.tools} tools / ${r.entities} entidades)`);
    for (const f of r.findings) {
        let line = `     ${f.rule}: ${f.msg}`;
        if (f.pairs) line += ` -> ${f.pairs.slice(0, 8).join('; ')}${f.pairs.length > 8 ? ` (+${f.pairs.length - 8} más)` : ''}`;
        if (f.tools) line += ` -> ${f.tools.join(', ')}`;
        console.log(line);
    }
    if (!ok) console.log('     -> superficie MCP inapta; revisá x-variant-of en familias reales o reducí opcionales libres.');
    process.exit(ok ? 0 : 1);
}

main();