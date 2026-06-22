// lib/mcp-git-tools.js
// Capa adaptadora MCP para los dominios repos / issues / pull requests.
// Sigue MCP-TOOLS-PLAN.md: tools orientadas a tareas (find/upsert/remove/state/comments/action),
// NO 1:1 con endpoints REST. Solo parsea params -> llama a la funcion de dominio de
// lib/gitRepos.js, lib/issues.js, lib/pulls.js -> devuelve el resultado.
// No toca actions ni postal (fuera del alcance de este chunk).

const path = require('path');
const fs = require('fs');

const gitRepos = require('./gitRepos');
const issues = require('./issues');
const pulls = require('./pulls');

// Mismos directorios base que los routers (.data/ ya esta en .gitignore).
const REPOS_DIR = path.join(__dirname, '..', '.data', 'repos');
const ISSUES_DIR = path.join(__dirname, '..', '.data', 'issues');
const PULLS_DIR = path.join(__dirname, '..', '.data', 'pulls');

// Path absoluto al repo bare de un repo por nombre.
function repoPath(name) {
    return path.join(REPOS_DIR, name + '.git');
}

// Lanza un Error legible a partir de cualquier error de dominio (RepoError/IssueError/PullError).
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

function registerGitTools(mcp) {
    // ========================================================================
    // REPOS
    // ========================================================================

    mcp.tool(
        'repos_find',
        'Lee uno o varios repositorios bare locales segun `mode`. ' +
        '`mode: one` devuelve la info (ramas + ultimo commit) del repo `name`; ' +
        '`mode: list` devuelve el listado ordenado por nombre, opcionalmente acotado por `limit`.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio. Obligatorio cuando `mode` es `one`.' },
                mode: {
                    type: 'string',
                    enum: ['one', 'list'],
                    description: "'one' para info de un repo concreto (requiere `name`); 'list' para listar todos. Por defecto 'list'."
                },
                list: {
                    type: 'object',
                    description: 'Controles del `mode: list`. Opcional, ignorado en `mode: one`.',
                    properties: {
                        limit: { type: 'number', description: 'Maximo numero de repos a devolver en `mode: list`. Opcional.' }
                    }
                }
            }
        },
        async (args) => {
            const mode = args.mode || 'list';
            try {
                if (mode === 'one') {
                    if (!args.name) throw domainError({ code: 'invalid_name', message: "'name' es obligatorio para mode=one" });
                    const info = await gitRepos.getRepoInfo(args.name, REPOS_DIR);
                    return { mode: 'one', repo: info };
                }
                const repos = await gitRepos.listRepos(REPOS_DIR);
                return { mode: 'list', total: repos.length, repos: applyLimit(repos, args.list && args.list.limit) };
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'repos_upsert',
        'Crea un repositorio bare local (`git init --bare`) con el nombre indicado. ' +
        'El parametro `body` admite configuracion adicional del repo; actualmente el dominio solo usa `name`.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio a crear (alfanumerico, hasta 63 chars, permite . _ -).' },
                body: { type: 'object', description: 'Configuracion adicional del repo (reservado para futura extension). Opcional.' }
            },
            required: ['name']
        },
        async (args) => {
            if (!args.name) throw domainError({ code: 'invalid_name', message: "'name' es obligatorio" });
            try {
                const repo = await gitRepos.createBareRepo(args.name, REPOS_DIR);
                return { mensaje: 'Repo creado', repo };
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'repos_remove',
        'Elimina un repositorio bare local por nombre. Lanza error si el repo no existe.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio a borrar.' }
            },
            required: ['name']
        },
        async (args) => {
            if (!args.name) throw domainError({ code: 'invalid_name', message: "'name' es obligatorio" });
            try {
                const result = await gitRepos.deleteRepo(args.name, REPOS_DIR);
                return { mensaje: 'Repo borrado', result };
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    // ========================================================================
    // ISSUES
    // ========================================================================

    mcp.tool(
        'issues_find',
        'Lee un issue o lista los issues de un repo segun `mode`. ' +
        "`mode: one` devuelve el issue `number` del repo `name`; " +
        "`mode: list` devuelve los issues, opcionalmente filtrados por `state` y `labels`, acotados por `limit`.",
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                number: { type: 'number', description: 'Numero del issue. Obligatorio cuando `mode` es `one`.' },
                mode: {
                    type: 'string',
                    enum: ['one', 'list'],
                    description: "'one' para un issue concreto (requiere `number`); 'list' para listar. Por defecto 'list'."
                },
                state: {
                    type: 'string',
                    enum: ['open', 'closed', 'all'],
                    description: "Filtro de estado en `mode: list`: 'open', 'closed' o 'all'. Por defecto 'all'."
                },
                labels: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Lista de labels a filtrar en `mode: list` (devuelve issues que contengan todas). Opcional.'
                },
                limit: { type: 'number', description: 'Maximo numero de issues a devolver en `mode: list`. Opcional.' }
            },
            required: ['name']
        },
        async (args) => {
            const mode = args.mode || 'list';
            try {
                if (mode === 'one') {
                    if (typeof args.number !== 'number') throw domainError({ code: 'invalid_body', message: "'number' es obligatorio para mode=one" });
                    const issue = await issues.getIssue(args.name, ISSUES_DIR, args.number);
                    return { mode: 'one', issue };
                }
                let list = await issues.listIssues(args.name, ISSUES_DIR, args.state || 'all');
                if (Array.isArray(args.labels) && args.labels.length > 0) {
                    const want = args.labels.map(String);
                    list = list.filter((i) => want.every((l) => (i.labels || []).includes(l)));
                }
                list = applyLimit(list, args.limit);
                return { mode: 'list', total: list.length, issues: list };
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'issues_upsert',
        'Crea o edita un issue del repo `name` segun `action`. ' +
        "`action: create` crea un issue con `title` y `body` (numero autoincremental, estado open); " +
        "`action: update` parchea `title` y/o `body` del issue `number` existente.",
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                number: { type: 'number', description: 'Numero del issue. Obligatorio cuando `action` es `update`.' },
                action: {
                    type: 'string',
                    enum: ['create', 'update'],
                    description: "'create' para crear un issue nuevo; 'update' para editar titulo/cuerpo de uno existente."
                },
                title: { type: 'string', description: 'Titulo del issue. Requerido en `create`; opcional en `update`.' },
                body: { type: 'string', description: 'Cuerpo (descripcion) del issue. Opcional.' },
                labels: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Labels del issue (solo `create`/`update` los aplica si estan presentes). Opcional.'
                }
            },
            required: ['name', 'action']
        },
        async (args) => {
            const action = args.action;
            try {
                if (action === 'create') {
                    if (typeof args.title !== 'string' || !args.title.trim()) throw domainError({ code: 'invalid_body', message: "'title' es obligatorio para action=create" });
                    const data = { title: args.title, body: args.body, labels: args.labels };
                    const issue = await issues.createIssue(args.name, ISSUES_DIR, data);
                    return { mensaje: 'Issue creado', issue };
                }
                if (action === 'update') {
                    if (typeof args.number !== 'number') throw domainError({ code: 'invalid_body', message: "'number' es obligatorio para action=update" });
                    const patch = {};
                    if (args.title !== undefined) patch.title = args.title;
                    if (args.body !== undefined) patch.body = args.body;
                    if (args.labels !== undefined) patch.labels = args.labels;
                    const issue = await issues.updateIssue(args.name, ISSUES_DIR, args.number, patch);
                    return { mensaje: 'Issue actualizado', issue };
                }
                throw domainError({ code: 'invalid_body', message: 'action inválido: ' + action });
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'issues_state',
        'Abre o cierra un issue estableciendo su `state`.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                number: { type: 'number', description: 'Numero del issue.' },
                state: {
                    type: 'string',
                    enum: ['open', 'closed'],
                    description: "Estado a asignar: 'open' (reabrir) o 'closed' (cerrar)."
                }
            },
            required: ['name', 'number', 'state']
        },
        async (args) => {
            try {
                const issue = await issues.setIssueState(args.name, ISSUES_DIR, args.number, args.state);
                return { mensaje: 'Estado actualizado', issue };
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'issues_comments',
        'Lista o agrega comentarios de un issue segun `mode`. ' +
        "`mode: list` devuelve los comentarios del issue `number`; " +
        "`mode: add` anhade un comentario con `body` (y `author` opcional).",
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                number: { type: 'number', description: 'Numero del issue.' },
                mode: {
                    type: 'string',
                    enum: ['list', 'add'],
                    description: "'list' para listar comentarios; 'add' para anhadir uno. Por defecto 'list'."
                },
                body: { type: 'string', description: 'Texto del comentario. Obligatorio cuando `mode` es `add`.' },
                author: { type: 'string', description: 'Autor del comentario (opcional, por defecto anonymous).' }
            },
            required: ['name', 'number'],
            'x-variant-of': ['prs_comments']
        },
        async (args) => {
            const mode = args.mode || 'list';
            try {
                if (mode === 'add') {
                    if (typeof args.body !== 'string' || !args.body.trim()) throw domainError({ code: 'invalid_body', message: "'body' es obligatorio para mode=add" });
                    const comment = await issues.addComment(args.name, ISSUES_DIR, args.number, { body: args.body, author: args.author });
                    return { mensaje: 'Comentario anhadido', comment };
                }
                const comments = await issues.listComments(args.name, ISSUES_DIR, args.number);
                return { mensaje: 'Comentarios del issue', total: comments.length, comments };
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    // ========================================================================
    // PULL REQUESTS
    // ========================================================================

    mcp.tool(
        'prs_find',
        'Lee un PR, lo lista, o muestra su diff/commits segun `mode`. ' +
        "`mode: one` devuelve el PR `number`; " +
        "`mode: list` lista los PRs (filtro `state`, acotado por `limit`); " +
        "`mode: diff` devuelve el diff resumido (numstat) base...head del PR `number`; " +
        "`mode: commits` devuelve los commits de head no presentes en base del PR `number`.",
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                number: { type: 'number', description: 'Numero del PR. Obligatorio para `mode` one/diff/commits.' },
                mode: {
                    type: 'string',
                    enum: ['one', 'list', 'diff', 'commits'],
                    description: "'one' (un PR), 'list' (listado), 'diff' (numstat base...head) o 'commits' (log base..head). Por defecto 'list'."
                },
                state: {
                    type: 'string',
                    enum: ['open', 'closed', 'merged', 'all'],
                    description: "Filtro de estado en `mode: list`: 'open', 'closed', 'merged' o 'all'. Por defecto 'all'."
                },
                limit: { type: 'number', description: 'Maximo numero de PRs a devolver en `mode: list`. Opcional.' }
            }
        },
        async (args) => {
            const mode = args.mode || 'list';
            try {
                if (mode === 'list') {
                    let list = await pulls.listPulls(args.name, PULLS_DIR, args.state || 'all');
                    list = applyLimit(list, args.limit);
                    return { mode: 'list', total: list.length, pulls: list };
                }
                if (typeof args.number !== 'number') throw domainError({ code: 'invalid_body', message: "'number' es obligatorio para mode=" + mode });
                const pull = await pulls.getPull(args.name, PULLS_DIR, args.number);
                if (mode === 'one') return { mode: 'one', pull };
                const rp = repoPath(args.name);
                if (!fs.existsSync(rp)) throw domainError({ code: 'not_found', message: 'repo no existe: ' + args.name });
                if (mode === 'diff') {
                    const diff = await pulls.getPrDiffStat(rp, pull.head, pull.base);
                    return { mode: 'diff', number: pull.number, diff };
                }
                if (mode === 'commits') {
                    const commits = await pulls.getPrCommits(rp, pull.head, pull.base);
                    return { mode: 'commits', number: pull.number, total: commits.length, commits };
                }
                throw domainError({ code: 'invalid_body', message: 'mode inválido: ' + mode });
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'prs_upsert',
        'Crea un pull request en el repo `name`. El parametro `body` indica `head`, `base`, `title` (y `body` opcional). ' +
        'Valida que las ramas head y base existan en el repo bare antes de crear el PR.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                body: {
                    type: 'object',
                    description: 'Datos del PR.',
                    properties: {
                        title: { type: 'string', description: 'Titulo del PR. Requerido.' },
                        head: { type: 'string', description: 'Rama origen (head). Requerido.' },
                        base: { type: 'string', description: 'Rama destino (base). Requerido.' },
                        body: { type: 'string', description: 'Descripcion del PR. Opcional.' }
                    },
                    required: ['title', 'head', 'base']
                }
            },
            required: ['name', 'body']
        },
        async (args) => {
            const data = args.body || {};
            try {
                const rp = repoPath(args.name);
                if (!fs.existsSync(rp)) throw domainError({ code: 'not_found', message: 'repo no existe: ' + args.name });
                await pulls.validateBranchesExist(rp, data.head, data.base);
                const pull = await pulls.createPull(args.name, PULLS_DIR, data);
                return { mensaje: 'Pull request creado', pull };
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'prs_action',
        'Cambia el estado o fusiona un PR segun `mode`. ' +
        "`mode: state` cambia el estado a `state` ('open' o 'closed'; 'merged' es terminal via merge); " +
        '`mode: merge` realiza el merge real de head en base en el repo bare y marca el PR como merged.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                number: { type: 'number', description: 'Numero del PR.' },
                mode: {
                    type: 'string',
                    enum: ['state', 'merge'],
                    description: "'state' para abrir/cerrar el PR; 'merge' para fusionar head en base."
                },
                state: {
                    type: 'string',
                    enum: ['open', 'closed'],
                    description: "Nuevo estado del PR. Obligatorio cuando `mode` es `state`."
                }
            },
            required: ['name', 'number', 'mode']
        },
        async (args) => {
            const mode = args.mode;
            try {
                if (mode === 'state') {
                    if (args.state !== 'open' && args.state !== 'closed') throw domainError({ code: 'invalid_state', message: "'state' debe ser 'open' o 'closed'" });
                    const pull = await pulls.setPullState(args.name, PULLS_DIR, args.number, args.state);
                    return { mensaje: 'Estado actualizado', pull };
                }
                if (mode === 'merge') {
                    const rp = repoPath(args.name);
                    if (!fs.existsSync(rp)) throw domainError({ code: 'not_found', message: 'repo no existe: ' + args.name });
                    const pull = await pulls.mergePull(args.name, PULLS_DIR, rp, args.number);
                    return { mensaje: 'Pull request mergeado', pull };
                }
                throw domainError({ code: 'invalid_body', message: 'mode inválido: ' + mode });
            } catch (err) {
                throw domainError(err);
            }
        }
    );

    mcp.tool(
        'prs_comments',
        'Lista o agrega comentarios de un PR segun `mode`. ' +
        "`mode: list` devuelve los comentarios del PR `number`; " +
        "`mode: add` anhade un comentario con `body` (y `author` opcional).",
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre del repositorio.' },
                number: { type: 'number', description: 'Numero del PR.' },
                mode: {
                    type: 'string',
                    enum: ['list', 'add'],
                    description: "'list' para listar comentarios; 'add' para anhadir uno. Por defecto 'list'."
                },
                body: { type: 'string', description: 'Texto del comentario. Obligatorio cuando `mode` es `add`.' },
                author: { type: 'string', description: 'Autor del comentario (opcional, por defecto anonymous).' }
            },
            required: ['name', 'number'],
            'x-variant-of': ['issues_comments']
        },
        async (args) => {
            const mode = args.mode || 'list';
            try {
                if (mode === 'add') {
                    if (typeof args.body !== 'string' || !args.body.trim()) throw domainError({ code: 'invalid_body', message: "'body' es obligatorio para mode=add" });
                    const comment = await pulls.addPullComment(args.name, PULLS_DIR, args.number, { body: args.body, author: args.author });
                    return { mensaje: 'Comentario anhadido', comment };
                }
                const comments = await pulls.listPullComments(args.name, PULLS_DIR, args.number);
                return { mensaje: 'Comentarios del PR', total: comments.length, comments };
            } catch (err) {
                throw domainError(err);
            }
        }
    );
}

module.exports = { registerGitTools };