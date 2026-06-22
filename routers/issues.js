const { APIRouter } = require('../lib/fastapi');
const path = require('path');
const {
    createIssue,
    listIssues,
    getIssue,
    updateIssue,
    setIssueState,
    addComment,
    listComments,
    IssueError,
    VALID_STATES
} = require('../lib/issues');
const { RepoError } = require('../lib/gitRepos');
const { dispatchEvent } = require('../lib/actions');
const { appendEvent } = require('../lib/postal');

// Mismo directorio base que routers/repos.js (.data/ ya está en .gitignore).
const ISSUES_DIR = path.join(__dirname, '..', '.data', 'issues');
const WORKFLOWS_DIR = path.join(__dirname, '..', '.data', 'workflows');
const RUNS_DIR = path.join(__dirname, '..', '.data', 'runs');
const REPOS_DIR = path.join(__dirname, '..', '.data', 'repos');
const EVENTS_DIR = path.join(__dirname, '..', '.data', 'events');

// Emite un evento Postal al log del repo (memoria del proyecto). Fire-and-forget:
// no bloquea ni rompe la operacion de issue si falla (igual que dispatchEvent de Actions).
function emitIssueEvent(repoName, kind, agentId, payload) {
    appendEvent(repoName, EVENTS_DIR, { kind, agentId, payload }).catch(() => {});
}

const issuesRouter = new APIRouter({
    prefix: '/repos',
    tags: ['Issues']
});

// Helper: mapea IssueError/RepoError a respuesta REST con el status adecuado.
function issueErrorResponse(res, err) {
    if (err instanceof IssueError) {
        const status = err.code === 'not_found' ? 404
            : (err.code === 'invalid_body' || err.code === 'invalid_state') ? 400
            : 500;
        return res.json({ detail: 'IssueError', code: err.code, mensaje: err.message }, status);
    }
    if (err instanceof RepoError) {
        const status = err.code === 'invalid_name' ? 400 : 500;
        return res.json({ detail: 'RepoError', code: err.code, mensaje: err.message }, status);
    }
    return res.json({ detail: 'Error interno', mensaje: err.message }, 500);
}

// Helper: parsea y valida el número de issue del path. Responde 400 si no es entero > 0.
function parseIssueNumber(res, raw) {
    const num = Number(raw);
    if (!Number.isInteger(num) || num <= 0) {
        res.json({ detail: 'Parámetro inválido', mensaje: "'number' debe ser entero positivo" }, 400);
        return null;
    }
    return num;
}

// Crear issue (POST /repos/:name/issues) — body { title, body?, labels? }
issuesRouter.post('/:name/issues', async (req, res) => {
    const body = req.body || {};
    if (typeof body.title !== 'string' || !body.title.trim()) {
        return res.json({ detail: 'Body inválido', mensaje: "'title' es obligatorio" }, 400);
    }
    try {
        const issue = await createIssue(req.params.name, ISSUES_DIR, body);
        // Auto-trigger Actions: disparar workflows con trigger 'issue_opened'.
        // Fire-and-forget: no bloquea ni rompe la creación del issue si falla.
        dispatchEvent(req.params.name, 'issue_opened', {
            workflowsDir: WORKFLOWS_DIR,
            runsDir: RUNS_DIR,
            cwd: path.join(REPOS_DIR, req.params.name + '.git')
        }).catch(() => {});
        // Postal: emitir evento de memoria (ademas de la persistencia del issue).
        emitIssueEvent(req.params.name, 'issue.created', body.agent || 'system', {
            number: issue.number, title: issue.title, state: issue.state, body: issue.body
        });
        return { mensaje: 'Issue creado', issue };
    } catch (err) {
        return issueErrorResponse(res, err);
    }
}, {
    summary: 'Crear issue',
    description: 'Crea un issue en el repo indicado. Estado inicial: open. Body: { title, body?, labels? }.',
    body: {
        title: { type: 'string', required: true },
        body: { type: 'string' },
        labels: { type: 'array' }
    }
});

// Listar issues (GET /repos/:name/issues?state=open|closed|all)
issuesRouter.get('/:name/issues', async (req, res) => {
    const state = req.query && req.query.state ? req.query.state : undefined;
    try {
        const issues = await listIssues(req.params.name, ISSUES_DIR, state);
        return { mensaje: 'Listado de issues', total: issues.length, issues };
    } catch (err) {
        return issueErrorResponse(res, err);
    }
}, {
    summary: 'Listar issues de un repo',
    description: 'Devuelve los issues del repo. Filtrar con ?state=open|closed|all (default: all).',
    query: {
        state: { type: 'string' }
    }
});

// Obtener un issue (GET /repos/:name/issues/:number)
issuesRouter.get('/:name/issues/:number', async (req, res) => {
    const number = parseIssueNumber(res, req.params.number);
    if (number === null) return;
    try {
        const issue = await getIssue(req.params.name, ISSUES_DIR, number);
        return { mensaje: 'Issue', issue };
    } catch (err) {
        return issueErrorResponse(res, err);
    }
}, {
    summary: 'Obtener un issue por número',
    description: 'Devuelve el issue indicado del repo.'
});

// Actualizar issue (PATCH /repos/:name/issues/:number) — body { title?, body?, labels? } (parcial)
issuesRouter.patch('/:name/issues/:number', async (req, res) => {
    const number = parseIssueNumber(res, req.params.number);
    if (number === null) return;
    const patch = req.body || {};
    if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim())) {
        return res.json({ detail: 'Body inválido', mensaje: "'title' no puede ser vacío" }, 400);
    }
    try {
        const issue = await updateIssue(req.params.name, ISSUES_DIR, number, patch);
        return { mensaje: 'Issue actualizado', issue };
    } catch (err) {
        return issueErrorResponse(res, err);
    }
}, {
    summary: 'Actualizar un issue (parcial)',
    description: 'Actualiza título/body/labels del issue (solo los campos presentes). Body: { title?, body?, labels? }.'
});

// Cerrar/reabrir issue (POST /repos/:name/issues/:number/state) — body { state: 'open'|'closed' }
issuesRouter.post('/:name/issues/:number/state', async (req, res) => {
    const number = parseIssueNumber(res, req.params.number);
    if (number === null) return;
    const state = req.body && req.body.state;
    if (!VALID_STATES.includes(state)) {
        return res.json({ detail: 'Body inválido', mensaje: "'state' debe ser 'open' o 'closed'" }, 400);
    }
    try {
        const issue = await setIssueState(req.params.name, ISSUES_DIR, number, state);
        emitIssueEvent(req.params.name, 'issue.state_changed', (req.body && req.body.agent) || 'system', {
            number: number, state: state
        });
        return { mensaje: 'Estado actualizado', issue };
    } catch (err) {
        return issueErrorResponse(res, err);
    }
}, {
    summary: 'Cerrar/reabrir un issue',
    description: 'Cambia el estado del issue. Body: { state: \'open\' | \'closed\' }.',
    body: {
        state: { type: 'string', required: true }
    }
});

// Añadir comentario (POST /repos/:name/issues/:number/comments) — body { author?, body }
issuesRouter.post('/:name/issues/:number/comments', async (req, res) => {
    const number = parseIssueNumber(res, req.params.number);
    if (number === null) return;
    const body = req.body || {};
    if (typeof body.body !== 'string' || !body.body.trim()) {
        return res.json({ detail: 'Body inválido', mensaje: "'body' es obligatorio" }, 400);
    }
    try {
        const comment = await addComment(req.params.name, ISSUES_DIR, number, body);
        emitIssueEvent(req.params.name, 'issue.commented', comment.author || 'system', {
            number: number, text: body.body
        });
        return { mensaje: 'Comentario añadido', comment };
    } catch (err) {
        return issueErrorResponse(res, err);
    }
}, {
    summary: 'Añadir comentario a un issue',
    description: 'Añade un comentario al issue. Body: { author?, body }.',
    body: {
        author: { type: 'string' },
        body: { type: 'string', required: true }
    }
});

// Listar comentarios (GET /repos/:name/issues/:number/comments)
issuesRouter.get('/:name/issues/:number/comments', async (req, res) => {
    const number = parseIssueNumber(res, req.params.number);
    if (number === null) return;
    try {
        const comments = await listComments(req.params.name, ISSUES_DIR, number);
        return { mensaje: 'Comentarios del issue', total: comments.length, comments };
    } catch (err) {
        return issueErrorResponse(res, err);
    }
}, {
    summary: 'Listar comentarios de un issue',
    description: 'Devuelve los comentarios del issue indicado.'
});

module.exports = issuesRouter;