const { APIRouter } = require('../lib/fastapi');
const path = require('path');
const fs = require('fs');
const {
    createPull,
    listPulls,
    getPull,
    setPullState,
    addPullComment,
    listPullComments,
    validateBranchesExist,
    getPrCommits,
    getPrDiffStat,
    mergePull,
    PullError,
    VALID_STATES
} = require('../lib/pulls');
const { RepoError } = require('../lib/gitRepos');
const { dispatchEvent } = require('../lib/actions');
const { appendEvent } = require('../lib/postal');
const { getCurrentUser } = require('../dependencies/auth');

// Mismo directorio base que routers/issues.js (.data/ ya está en .gitignore).
const PULLS_DIR = path.join(__dirname, '..', '.data', 'pulls');
const WORKFLOWS_DIR = path.join(__dirname, '..', '.data', 'workflows');
const RUNS_DIR = path.join(__dirname, '..', '.data', 'runs');
const REPOS_DIR = path.join(__dirname, '..', '.data', 'repos');
const EVENTS_DIR = path.join(__dirname, '..', '.data', 'events');

// Emite un evento Postal al log del repo (memoria del proyecto). Fire-and-forget:
// no bloquea ni rompe la operacion de PR si falla (igual que dispatchEvent de Actions).
function emitPullEvent(repoName, kind, agentId, payload) {
    appendEvent(repoName, EVENTS_DIR, { kind, agentId, payload }).catch(() => {});
}

// HARDENING: todo endpoint (GET + escritura) exige token Bearer via getCurrentUser.
// Reusa dependencies/auth.js (mismo patron que routers/items.js). Sin token -> 401.
const pullsRouter = new APIRouter({
    prefix: '/repos',
    tags: ['Pulls'],
    dependencies: { user: getCurrentUser }
});

// Path al repo bare de un repo por nombre.
function repoPath(name) {
    return path.join(REPOS_DIR, name + '.git');
}

// Helper: mapea PullError/RepoError a respuesta REST con el status adecuado.
function pullErrorResponse(res, err) {
    if (err instanceof PullError) {
        const status = err.code === 'not_found' ? 404
            : err.code === 'merge_conflict' ? 409
            : (err.code === 'invalid_body' || err.code === 'invalid_state'
                || err.code === 'invalid_branch' || err.code === 'branch_not_found') ? 400
            : 500;
        return res.json({ detail: 'PullError', code: err.code, mensaje: err.message }, status);
    }
    if (err instanceof RepoError) {
        const status = err.code === 'invalid_name' ? 400 : 500;
        return res.json({ detail: 'RepoError', code: err.code, mensaje: err.message }, status);
    }
    return res.json({ detail: 'Error interno', mensaje: err.message }, 500);
}

// Helper: parsea y valida el número de PR del path. Responde 400 si no es entero > 0.
function parsePullNumber(res, raw) {
    const num = Number(raw);
    if (!Number.isInteger(num) || num <= 0) {
        res.json({ detail: 'Parámetro inválido', mensaje: "'number' debe ser entero positivo" }, 400);
        return null;
    }
    return num;
}

// Helper: valida que el repo bare exista. Responde 404 si no.
function ensureRepoExists(res, name) {
    const rp = repoPath(name);
    if (!fs.existsSync(rp)) {
        res.json({ detail: 'RepoError', code: 'repo_not_found', mensaje: 'repo no existe: ' + name }, 404);
        return null;
    }
    return rp;
}

// Crear PR (POST /repos/:name/pulls) — body { title, body?, head, base }
pullsRouter.post('/:name/pulls', async (req, res) => {
    const name = req.params.name;
    const body = req.body || {};
    if (typeof body.title !== 'string' || !body.title.trim()) {
        return res.json({ detail: 'Body inválido', mensaje: "'title' es obligatorio" }, 400);
    }
    if (typeof body.head !== 'string' || !body.head.trim() || typeof body.base !== 'string' || !body.base.trim()) {
        return res.json({ detail: 'Body inválido', mensaje: "'head' y 'base' son obligatorios" }, 400);
    }
    const rp = ensureRepoExists(res, name);
    if (rp === null) return;
    try {
        // Validar que head y base existen como ramas en el repo bare (clear error si no).
        await validateBranchesExist(rp, body.head, body.base);
        const pull = await createPull(name, PULLS_DIR, body);
        // Auto-trigger Actions: disparar workflows con trigger 'pull_request' (fire-and-forget).
        dispatchEvent(name, 'pull_request', {
            workflowsDir: WORKFLOWS_DIR,
            runsDir: RUNS_DIR,
            cwd: rp,
            pullNumber: pull.number
        }).catch(() => {});
        // Postal: emitir evento de memoria del PR creado.
        emitPullEvent(name, 'pr.created', body.agent || 'system', {
            number: pull.number, title: pull.title, state: pull.state, head: pull.head, base: pull.base
        });
        return { mensaje: 'Pull request creado', pull };
    } catch (err) {
        return pullErrorResponse(res, err);
    }
}, {
    summary: 'Crear pull request',
    description: 'Crea un PR en el repo indicado. Valida que head/base existan como ramas. Estado inicial: open. Body: { title, body?, head, base }.',
    body: {
        title: { type: 'string', required: true },
        body: { type: 'string' },
        head: { type: 'string', required: true },
        base: { type: 'string', required: true }
    }
});

// Listar PRs (GET /repos/:name/pulls?state=open|closed|merged|all)
pullsRouter.get('/:name/pulls', async (req, res) => {
    const state = req.query && req.query.state ? req.query.state : undefined;
    try {
        const pulls = await listPulls(req.params.name, PULLS_DIR, state);
        return { mensaje: 'Listado de pull requests', total: pulls.length, pulls };
    } catch (err) {
        return pullErrorResponse(res, err);
    }
}, {
    summary: 'Listar pull requests de un repo',
    description: 'Devuelve los PRs del repo. Filtrar con ?state=open|closed|merged|all (default: all).',
    query: {
        state: { type: 'string' }
    }
});

// Obtener un PR (GET /repos/:name/pulls/:number)
pullsRouter.get('/:name/pulls/:number', async (req, res) => {
    const number = parsePullNumber(res, req.params.number);
    if (number === null) return;
    try {
        const pull = await getPull(req.params.name, PULLS_DIR, number);
        return { mensaje: 'Pull request', pull };
    } catch (err) {
        return pullErrorResponse(res, err);
    }
}, {
    summary: 'Obtener un pull request por número',
    description: 'Devuelve el PR indicado del repo.'
});

// Commits del PR (GET /repos/:name/pulls/:number/commits) — git log base..head
pullsRouter.get('/:name/pulls/:number/commits', async (req, res) => {
    const name = req.params.name;
    const number = parsePullNumber(res, req.params.number);
    if (number === null) return;
    const rp = ensureRepoExists(res, name);
    if (rp === null) return;
    try {
        const pull = await getPull(name, PULLS_DIR, number);
        const commits = await getPrCommits(rp, pull.head, pull.base);
        return { mensaje: 'Commits del PR', total: commits.length, commits };
    } catch (err) {
        return pullErrorResponse(res, err);
    }
}, {
    summary: 'Commits de un pull request',
    description: 'Devuelve los commits de head no presentes en base (git log base..head).'
});

// Diff del PR (GET /repos/:name/pulls/:number/diff) — git diff --numstat base...head
pullsRouter.get('/:name/pulls/:number/diff', async (req, res) => {
    const name = req.params.name;
    const number = parsePullNumber(res, req.params.number);
    if (number === null) return;
    const rp = ensureRepoExists(res, name);
    if (rp === null) return;
    try {
        const pull = await getPull(name, PULLS_DIR, number);
        const diff = await getPrDiffStat(rp, pull.head, pull.base);
        return { mensaje: 'Diff del PR', diff };
    } catch (err) {
        return pullErrorResponse(res, err);
    }
}, {
    summary: 'Diff de un pull request',
    description: 'Devuelve el diff resumido entre base y head (git diff --numstat base...head).'
});

// Cerrar/reabrir PR (POST /repos/:name/pulls/:number/state) — body { state: 'open'|'closed' }
pullsRouter.post('/:name/pulls/:number/state', async (req, res) => {
    const number = parsePullNumber(res, req.params.number);
    if (number === null) return;
    const state = req.body && req.body.state;
    if (state !== 'open' && state !== 'closed') {
        return res.json({ detail: 'Body inválido', mensaje: "'state' debe ser 'open' o 'closed'" }, 400);
    }
    try {
        const pull = await setPullState(req.params.name, PULLS_DIR, number, state);
        emitPullEvent(req.params.name, 'pr.state_changed', (req.body && req.body.agent) || 'system', {
            number: number, state: state
        });
        return { mensaje: 'Estado actualizado', pull };
    } catch (err) {
        return pullErrorResponse(res, err);
    }
}, {
    summary: 'Cerrar/reabrir un pull request',
    description: "Cambia el estado del PR (no permite 'merged'; es terminal vía merge). Body: { state: 'open' | 'closed' }.",
    body: {
        state: { type: 'string', required: true }
    }
});

// Mergear PR (POST /repos/:name/pulls/:number/merge) — merge real de head en base
pullsRouter.post('/:name/pulls/:number/merge', async (req, res) => {
    const name = req.params.name;
    const number = parsePullNumber(res, req.params.number);
    if (number === null) return;
    const rp = ensureRepoExists(res, name);
    if (rp === null) return;
    try {
        const pull = await mergePull(name, PULLS_DIR, rp, number);
        // Auto-trigger Actions: disparar workflows con trigger 'pr_merged' (fire-and-forget).
        dispatchEvent(name, 'pr_merged', {
            workflowsDir: WORKFLOWS_DIR,
            runsDir: RUNS_DIR,
            cwd: rp,
            pullNumber: pull.number,
            mergeCommitSha: pull.mergeCommitSha
        }).catch(() => {});
        // Postal: emitir evento de memoria del PR mergeado (incluye mergeCommitSha).
        emitPullEvent(name, 'pr.merged', (req.body && req.body.agent) || 'system', {
            number: pull.number, mergeCommitSha: pull.mergeCommitSha, head: pull.head, base: pull.base
        });
        return { mensaje: 'Pull request mergeado', pull };
    } catch (err) {
        return pullErrorResponse(res, err);
    }
}, {
    summary: 'Mergear un pull request',
    description: 'Merge real de head en base en el repo bare (worktree temporal). Marca el PR como merged con el merge commit SHA. 409 si hay conflicto.'
});

// Añadir comentario (POST /repos/:name/pulls/:number/comments) — body { author?, body }
pullsRouter.post('/:name/pulls/:number/comments', async (req, res) => {
    const number = parsePullNumber(res, req.params.number);
    if (number === null) return;
    const body = req.body || {};
    if (typeof body.body !== 'string' || !body.body.trim()) {
        return res.json({ detail: 'Body inválido', mensaje: "'body' es obligatorio" }, 400);
    }
    try {
        const comment = await addPullComment(req.params.name, PULLS_DIR, number, body);
        emitPullEvent(req.params.name, 'pr.commented', comment.author || 'system', {
            number: number, text: body.body
        });
        return { mensaje: 'Comentario añadido', comment };
    } catch (err) {
        return pullErrorResponse(res, err);
    }
}, {
    summary: 'Añadir comentario a un pull request',
    description: 'Añade un comentario al PR. Body: { author?, body }.',
    body: {
        author: { type: 'string' },
        body: { type: 'string', required: true }
    }
});

// Listar comentarios (GET /repos/:name/pulls/:number/comments)
pullsRouter.get('/:name/pulls/:number/comments', async (req, res) => {
    const number = parsePullNumber(res, req.params.number);
    if (number === null) return;
    try {
        const comments = await listPullComments(req.params.name, PULLS_DIR, number);
        return { mensaje: 'Comentarios del PR', total: comments.length, comments };
    } catch (err) {
        return pullErrorResponse(res, err);
    }
}, {
    summary: 'Listar comentarios de un pull request',
    description: 'Devuelve los comentarios del PR indicado.'
});

module.exports = pullsRouter;