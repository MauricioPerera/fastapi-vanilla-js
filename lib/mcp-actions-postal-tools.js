// lib/mcp-actions-postal-tools.js
// Capa adaptadora MCP para los dominios actions y postal.
// Sigue MCP-TOOLS-PLAN.md: tools orientadas a tareas (find/upsert/dispatch,
// find/identity/event), NO 1:1 con endpoints REST. Solo parsea params -> llama a la
// funcion de dominio de lib/actions.js y lib/postal.js -> devuelve el resultado.
// Continuacion del patron de lib/mcp-git-tools.js (chunk A). Solo capa adaptadora.

const path = require('path');

const actions = require('./actions');
const postal = require('./postal');

// Mismos directorios base que los routers (.data/ ya esta en .gitignore).
const REPOS_DIR = path.join(__dirname, '..', '.data', 'repos');
const WORKFLOWS_DIR = path.join(__dirname, '..', '.data', 'workflows');
const RUNS_DIR = path.join(__dirname, '..', '.data', 'runs');
const EVENTS_DIR = path.join(__dirname, '..', '.data', 'events');
const IDENTITIES_DIR = path.join(__dirname, '..', '.data', 'identities');

// Path absoluto al repo bare de un repo por nombre (cwd donde se ejecutan los steps).
function repoPath(name) {
    return path.join(REPOS_DIR, name + '.git');
}

// Lanza un Error legible a partir de cualquier error de dominio (ActionError/PostalError/RepoError).
// FastMCP captura el throw y lo devuelve como error JSON-RPC.
function domainError(err) {
    if (err && err.code) {
        const e = new Error('[' + err.code + '] ' + err.message);
        e.code = err.code;
        return e;
    }
    return err instanceof Error ? err : new Error(String(err));
}

function applyLimit(arr, limit) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return arr;
    return arr.slice(0, Math.floor(limit));
}

// Construye el ctx de actions (workflowsDir, runsDir, cwd del repo bare) para un repo.
// Los steps ejecutan shell ARBITRARIO por diseno (como GitHub Actions) en el cwd del repo
// bare. Ejecucion LOCAL de confianza: no exponer a input no confiable.
function actionsCtx(repoName) {
    return {
        workflowsDir: WORKFLOWS_DIR,
        runsDir: RUNS_DIR,
        cwd: repoPath(repoName)
    };
}

function registerActionsPostalTools(mcp) {
    // ========================================================================
    // ACTIONS
    // ========================================================================

    mcp.tool(
        'actions_find',
        'Lee runs, un run o los workflows de un repo segun `mode`. ' +
        "`mode: runs` lista los runs (acotado por `limit`); " +
        "`mode: run` devuelve el run `runId` con sus steps y salida; " +
        "`mode: workflows` lista los workflows definidos (acotado por `limit`).",
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                mode: {
                    type: 'string',
                    enum: ['runs', 'run', 'workflows'],
                    description: "'runs' (listado de ejecuciones), 'run' (un run concreto, requiere `runId`) o 'workflows' (listado de workflows). Por defecto 'runs'."
                },
                run: {
                    type: 'object',
                    description: 'Controles de run/workflows: `runId` (`mode: run`) y `limit` (`mode: runs/workflows`). Opcional.',
                    properties: {
                        runId: { type: 'string', description: 'Identificador del run. Obligatorio cuando `mode` es `run`.' },
                        limit: { type: 'number', description: 'Maximo numero de items a devolver en `mode` runs/workflows. Opcional.' }
                    }
                }
            },
            required: ['name']
        },
        async (args) => {
            const mode = args.mode || 'runs';
            const runArgs = args.run || {};
            try {
                if (mode === 'run') {
                    if (typeof runArgs.runId !== 'string' || !runArgs.runId.trim()) throw domainError({ code: 'invalid_id', message: "'runId' es obligatorio para mode=run" });
                    const run = await actions.getRun(args.name, RUNS_DIR, runArgs.runId);
                    return { mode: 'run', run };
                }
                if (mode === 'workflows') {
                    const workflows = await actions.listWorkflows(args.name, WORKFLOWS_DIR);
                    return { mode: 'workflows', total: workflows.length, workflows: applyLimit(workflows, runArgs.limit) };
                }
                if (mode === 'runs') {
                    const runs = await actions.listRuns(args.name, RUNS_DIR);
                    return { mode: 'runs', total: runs.length, runs: applyLimit(runs, runArgs.limit) };
                }
                throw domainError({ code: 'invalid_body', message: 'mode inválido: ' + mode });
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'actions_upsert',
        'Crea o reemplaza un workflow del repo `name`. El parametro `body` lleva la definicion: ' +
        "`name` (nombre del workflow), `trigger` (uno de: " + actions.VALID_TRIGGERS.join(', ') + ") y " +
        '`steps` (array no vacio de strings o {command, name?}).',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                body: {
                    type: 'object',
                    description: 'Definicion del workflow.',
                    properties: {
                        name: { type: 'string', description: 'Nombre del workflow. Requerido.' },
                        trigger: {
                            type: 'string',
                            enum: actions.VALID_TRIGGERS,
                            description: 'Disparador del workflow: ' + actions.VALID_TRIGGERS.join(', ') + '.'
                        },
                        steps: {
                            type: 'array',
                            description: 'Pasos del workflow. Array no vacio de strings (command) u objetos { command, name? }.'
                        }
                    },
                    required: ['name', 'trigger', 'steps']
                }
            },
            required: ['name', 'body']
        },
        async (args) => {
            const data = args.body || {};
            try {
                const result = await actions.saveWorkflow(args.name, WORKFLOWS_DIR, data);
                return { mensaje: 'Workflow definido', workflow: result };
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'actions_dispatch',
        'Dispara manualmente el workflow `wf` del repo `name` y persiste el run resultante. ' +
        'Los steps se ejecutan secuencialmente en el cwd del repo bare (shell arbitrario, ejecucion local de confianza). ' +
        '`ref` e `inputs` se aceptan por compatibilidad con el dispatch estilo GitHub Actions pero el motor local actual no los consume.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                wf: { type: 'string', description: 'Nombre del workflow a disparar. Requerido.' },
                ref: { type: 'string', description: 'Referencia git (branch/tag). Reservado: el motor local ejecuta sobre el cwd del repo bare (no hace checkout de ref). Opcional.' },
                inputs: { type: 'object', description: 'Inputs del workflow. Reservado: el motor actual no los consume. Opcional.' }
            },
            required: ['name', 'wf']
        },
        async (args) => {
            try {
                const run = await actions.dispatchWorkflow(args.name, args.wf, 'manual', actionsCtx(args.name));
                return { mensaje: 'Workflow disparado', run };
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    // ========================================================================
    // POSTAL
    // ========================================================================

    mcp.tool(
        'postal_find',
        'Lee la timeline o el estado proyectado del repo `name` segun `mode`. ' +
        "`mode: timeline` devuelve el historial legible (opcionalmente filtrado por `actor` y `event`, acotado por `limit`); " +
        '`mode: state` devuelve el estado reconstruido plegando los eventos verificados.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                mode: {
                    type: 'string',
                    enum: ['timeline', 'state'],
                    description: "'timeline' (historial legible) o 'state' (estado proyectado). Por defecto 'timeline'."
                },
                timeline: {
                    type: 'object',
                    description: 'Filtros del `mode: timeline`. Opcional, ignorado en `mode: state`.',
                    properties: {
                        actor: { type: 'string', description: 'Filtro por autor (agentId) en `mode: timeline`. Opcional.' },
                        event: { type: 'string', description: 'Filtro por kind de evento en `mode: timeline`. Opcional.' },
                        limit: { type: 'number', description: 'Maximo numero de items a devolver en `mode: timeline`. Opcional.' }
                    }
                }
            },
            required: ['name']
        },
        async (args) => {
            const mode = args.mode || 'timeline';
            const tl = args.timeline || {};
            try {
                const r = await postal.replayEvents(args.name, EVENTS_DIR, IDENTITIES_DIR);
                if (mode === 'state') {
                    return { mode: 'state', total: r.total, verified: r.verified, state: r.state, failures: r.failures };
                }
                if (mode === 'timeline') {
                    let timeline = r.timeline;
                    if (tl.actor) timeline = timeline.filter((t) => t.from === tl.actor);
                    if (tl.event) timeline = timeline.filter((t) => t.kind === tl.event);
                    timeline = applyLimit(timeline, tl.limit);
                    return { mode: 'timeline', total: r.total, verified: r.verified, timeline, failures: r.failures };
                }
                throw domainError({ code: 'invalid_input', message: 'mode inválido: ' + mode });
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'postal_identity',
        'Lista o agrega identidades de agentes del repo `name` segun `mode`. ' +
        "`mode: list` devuelve las identidades registradas (solo claves publicas); " +
        '`mode: add` registra una identidad: si `body.publicKeyJwk` llega la registra, si no genera un keypair ECDSA P-256 nuevo. ' +
        'En `add` la clave PRIVADA se devuelve una sola vez (no se persiste).',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                mode: {
                    type: 'string',
                    enum: ['list', 'add'],
                    description: "'list' para listar identidades; 'add' para registrar una. Por defecto 'list'."
                },
                body: {
                    type: 'object',
                    description: 'Datos de la identidad a registrar (solo `mode: add`). Opcional.',
                    properties: {
                        publicKeyJwk: {
                            type: 'object',
                            description: 'Clave publica JWK ECDSA P-256 a registrar. Si se omite, se genera un keypair nuevo. Opcional.'
                        }
                    }
                }
            },
            required: ['name']
        },
        async (args) => {
            const mode = args.mode || 'list';
            try {
                if (mode === 'list') {
                    const identities = await postal.listIdentities(args.name, IDENTITIES_DIR);
                    return { mode: 'list', total: identities.length, identities };
                }
                if (mode === 'add') {
                    const body = args.body || {};
                    let publicKeyJwk = body.publicKeyJwk;
                    let privateKeyJwk = null;
                    if (!publicKeyJwk) {
                        const kp = await postal.generateIdentity();
                        publicKeyJwk = kp.publicKeyJwk;
                        privateKeyJwk = kp.privateKeyJwk;
                    }
                    const reg = await postal.registerIdentity(args.name, IDENTITIES_DIR, publicKeyJwk);
                    return {
                        mode: 'add',
                        mensaje: reg.existed ? 'Identidad ya registrada (idempotente)' : 'Identidad registrada',
                        agentId: reg.agentId,
                        publicKeyJwk: reg.publicKeyJwk,
                        privateKeyJwk,
                        existed: reg.existed,
                        advertencia: privateKeyJwk
                            ? 'La privateKeyJwk NO se persiste. Guardala; reenviala como body.identity.signPrivateJwk al postear eventos.'
                            : undefined
                    };
                }
                throw domainError({ code: 'invalid_input', message: 'mode inválido: ' + mode });
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'postal_event',
        'Registra (append) un evento firmado encadenado en la timeline del repo `name`. ' +
        'El parametro `body` lleva `kind`, `agentId`, `payload` (opcional), `to` (opcional) e `identity` (opcional, con `signPrivateJwk` para firmar).',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                body: {
                    type: 'object',
                    description: 'Datos del evento a registrar.',
                    properties: {
                        kind: { type: 'string', description: 'Kind/tipo del evento (ej: agent.message, issue.created, run.started). Requerido.' },
                        agentId: { type: 'string', description: 'Identificador del autor (agentId). Requerido.' },
                        payload: { type: 'object', description: 'Cuerpo del evento. Opcional.' },
                        to: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Destinatarios (agentIds). Opcional.'
                        },
                        identity: {
                            type: 'object',
                            description: 'Identidad del autor para firmar el evento. Debe llevar `signPrivateJwk` (JWK ECDSA P-256). Opcional: si se omite, el evento se registra sin firma.',
                            properties: {
                                signPrivateJwk: { type: 'object', description: 'Clave privada JWK ECDSA P-256 del autor. Opcional.' }
                            }
                        }
                    },
                    required: ['kind', 'agentId']
                }
            },
            required: ['name', 'body']
        },
        async (args) => {
            const data = args.body || {};
            try {
                const ev = await postal.appendEvent(args.name, EVENTS_DIR, {
                    kind: data.kind,
                    agentId: data.agentId,
                    payload: data.payload,
                    to: data.to,
                    identity: data.identity
                });
                return { mensaje: 'Evento posteado', event: ev };
            } catch (err) {
                throw domainError(err);
            }
        }
    );
}

module.exports = { registerActionsPostalTools };