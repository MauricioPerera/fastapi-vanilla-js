/**
 * ccdd/aacs-lite.js — gate de APTITUD de superficie MCP, puro JS, ZERO-DEP.
 *
 * Núcleo ESTRUCTURAL de AACS v0.1 (no la spec completa): reproduce las reglas que cazan el
 * anti-patrón "1 endpoint = 1 tool" sobre el OpenAPI que el framework ya genera:
 *   - tool-count  (ERROR > 20)
 *   - entity-ratio tools/entidad (ERROR > 7)
 *   - J_shape: dos tools con árbol de tipos IDÉNTICO (ignora nombres) -> ERROR (> 0.95)
 *   - U (opcionales libres) por tool (ERROR > 5)
 * Referencia conformante = AACS en Python (aacs/). Esto es el subset estructural, validado
 * para dar el MISMO veredicto que el gate Python sobre superficies reales.
 *
 * Fingerprint canónico (no necesita igualar el hash de Python; la Jaccard sale idéntica):
 *   fp(n) = [kind, type, sorted(children fps)]   — name-blind, igual que la spec §3.5.
 */
'use strict';

const TC_ERROR = 20, ER_ERROR = 7, JS_ERROR = 0.95, U_ERROR = 5;
const SYSTEM_PATHS = new Set(['/', '/docs', '/openapi.json', '/auth/login', '/auth/register', '/sse', '/message']);
const HTTP = ['get', 'post', 'put', 'patch', 'delete'];

// ---- $ref inline con guarda de ciclo (paridad con openapi_to_doc.py) ----------------
function resolveRef(spec, ref) {
    const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let n = spec;
    for (const p of parts) {
        if (!n || typeof n !== 'object' || !(p in n)) return null;
        n = n[p];
    }
    return n;
}
function deref(node, spec, stack) {
    if (Array.isArray(node)) return node.map((x) => deref(x, spec, stack));
    if (node && typeof node === 'object') {
        const ref = node.$ref;
        if (typeof ref === 'string' && ref.startsWith('#/')) {
            if (stack.includes(ref)) return { $ref: ref };
            const t = resolveRef(spec, ref);
            if (!t || typeof t !== 'object') return { $ref: ref };
            return deref(t, spec, stack.concat(ref));
        }
        const o = {};
        for (const k of Object.keys(node)) o[k] = deref(node[k], spec, stack);
        return o;
    }
    return node;
}

// ---- OpenAPI -> superficie de tools (1:1, como el bridge) ---------------------------
function entityOf(op, path) {
    if (Array.isArray(op.tags) && typeof op.tags[0] === 'string') return op.tags[0];
    for (const seg of path.replace(/^\/|\/$/g, '').split('/')) if (seg && !seg.startsWith('{')) return seg;
    return 'root';
}
function inputSchema(op, item, spec) {
    const props = {}; const required = [];
    const params = (item.parameters || []).concat(op.parameters || []);
    for (let p of params) {
        p = deref(p, spec, []);
        if (!p || typeof p.name !== 'string') continue;
        let sch = deref(p.schema || {}, spec, []);
        if (typeof p.description === 'string' && !('description' in sch)) sch = Object.assign({ description: p.description }, sch);
        props[p.name] = sch;
        if (p.required) required.push(p.name);
    }
    const body = op.requestBody ? deref(op.requestBody, spec, []) : null;
    const bsch = body && body.content && body.content['application/json'] ? deref(body.content['application/json'].schema || {}, spec, []) : null;
    if (bsch && bsch.type === 'object' && bsch.properties && typeof bsch.properties === 'object') {
        Object.assign(props, bsch.properties);
        if (Array.isArray(bsch.required)) required.push(...bsch.required);
    } else if (bsch && Object.keys(bsch).length) {
        props.body = bsch;
        if (body.required) required.push('body');
    }
    const out = { type: 'object', properties: props };
    if (required.length) out.required = [...new Set(required)].sort();
    return out;
}
function toolsFromOpenAPI(spec, filterSystem) {
    const tools = [];
    for (const [path, item] of Object.entries(spec.paths || {})) {
        if (filterSystem && SYSTEM_PATHS.has(path)) continue;
        if (!item || typeof item !== 'object') continue;
        for (const [method, op] of Object.entries(item)) {
            if (!HTTP.includes(method.toLowerCase()) || !op || typeof op !== 'object') continue;
            const id = op.operationId || (method + '_' + path.replace(/^\/|\/$/g, '').replace(/[/{}]/g, '_'));
            tools.push({ id, entity: entityOf(op, path), inputSchema: inputSchema(op, item, spec) });
        }
    }
    return tools;
}

// ---- árbol de tipos + fingerprint (name-blind) + J_shape ----------------------------
function classifyKind(s) {
    if (!s || typeof s !== 'object') return 'scalar';
    if ('$ref' in s) return 'ref';
    if (s.type === 'array') return 'array';
    if ((s.oneOf || s.anyOf || s.allOf) && !('properties' in s || s.type === 'object')) return 'combinator';
    if ('properties' in s || s.type === 'object') return 'object';
    return 'scalar';
}
function buildTree(s) {
    if (!s || typeof s !== 'object') return { kind: 'scalar', type: null, children: [] };
    const k = classifyKind(s);
    if (k === 'ref') return { kind: 'ref', type: null, children: [] };
    if (k === 'array') {
        const it = s.items;
        const child = (it && typeof it === 'object') ? buildTree(it) : { kind: 'scalar', type: null, children: [] };
        return { kind: 'array', type: 'array', children: [child] };
    }
    if (k === 'combinator') {
        const name = ['oneOf', 'anyOf', 'allOf'].find((c) => c in s);
        const list = Array.isArray(s[name]) ? s[name] : [];
        return { kind: 'combinator', type: null, children: list.map(buildTree) };
    }
    if (k === 'object') {
        const props = (s.properties && typeof s.properties === 'object') ? s.properties : {};
        return { kind: 'object', type: s.type != null ? s.type : null, children: Object.keys(props).sort().map((key) => buildTree(props[key])) };
    }
    return { kind: 'scalar', type: s.type != null ? s.type : null, children: [] };
}
function fingerprint(node) {
    const childFps = node.children.map(fingerprint).sort();
    return JSON.stringify([node.kind, node.type != null ? node.type : null, childFps]);
}
function allFingerprints(node) {
    const set = new Set([fingerprint(node)]);
    for (const c of node.children) for (const fp of allFingerprints(c)) set.add(fp);
    return set;
}
function jShape(a, b) {
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter || 1);
}
function undisciplinedU(s) {
    const props = Object.keys((s && s.properties) || {});
    if (!props.length) return 0;
    const req = new Set(s && s.required || []);
    return props.filter((p) => !req.has(p)).length; // sin combinadores raíz, disciplined ≈ ∅
}

// ---- gate ----------------------------------------------------------------------------
function gate(tools) {
    const findings = [];
    const entities = new Set(tools.map((t) => t.entity));
    if (tools.length > TC_ERROR) findings.push({ rule: 'tool-count', sev: 'ERROR', msg: `${tools.length} > 20` });
    const ratio = tools.length / Math.max(1, entities.size);
    if (ratio > ER_ERROR) findings.push({ rule: 'entity-ratio', sev: 'ERROR', msg: ratio.toFixed(2) });
    const fps = tools.map((t) => allFingerprints(buildTree(t.inputSchema)));
    const pairs = [];
    for (let i = 0; i < tools.length; i++) for (let j = i + 1; j < tools.length; j++) {
        if (jShape(fps[i], fps[j]) > JS_ERROR) pairs.push(`${tools[i].id}~${tools[j].id}`);
    }
    if (pairs.length) findings.push({ rule: 'j-shape', sev: 'ERROR', msg: `${pairs.length} pares idénticos`, pairs });
    const undisc = tools.filter((t) => undisciplinedU(t.inputSchema) > U_ERROR).map((t) => t.id);
    if (undisc.length) findings.push({ rule: 'undisciplined', sev: 'ERROR', msg: `${undisc.length} tools`, tools: undisc });
    const verdict = findings.some((f) => f.sev === 'ERROR') ? 'FAIL' : 'PASS';
    return { verdict, tools: tools.length, entities: entities.size, findings };
}

module.exports = { gate, toolsFromOpenAPI, buildTree, allFingerprints, jShape };

// CLI: node aacs-lite.js openapi.json
if (require.main === module) {
    const fs = require('fs');
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Uso: node aacs-lite.js <path-to-openapi.json>');
        process.exit(1);
    }
    const spec = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const r = gate(toolsFromOpenAPI(spec, true));
    console.log(JSON.stringify(r, null, 1));
    process.exit(r.verdict === 'PASS' ? 0 : 1);
}
