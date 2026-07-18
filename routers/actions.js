const { APIRouter } = require('../lib/fastapi');
const path = require('path');
const {
    saveWorkflow,
    listWorkflows,
    dispatchWorkflow,
    listRuns,
    getRun,
    ActionError,
    VALID_TRIGGERS
} = require('../lib/actions');
const { RepoError } = require('../lib/gitRepos');
const { appendEvent } = require('../lib/postal');
const { getCurrentUser, requireAdmin } = require('../dependencies/auth');

// Directorios base (.data/ ya está en .gitignore). Mismo REPOS_DIR que routers/repos.js
// para resolver el cwd donde se ejecutan los steps (el repo bare).
const WORKFLOWS_DIR = path.join(__dirname, '..', '.data', 'workflows');
const RUNS_DIR = path.join(__dirname, '..', '.data', 'runs');
const REPOS_DIR = path.join(__dirname, '..', '.data', 'repos');
const EVENTS_DIR = path.join(__dirname, '..', '.data', 'events');

// Emite un evento Postal al log del repo (memoria del proyecto). Devuelve la promesa
// (sin await) para que el caller pueda encadenar emisiones del mismo agente en serie
// y evitar que compitan por el chain tip (seq/prev). Errores se tragan (fire-and-forget).
function emitActionEvent(repoName, kind, agentId, payload) {
    return appendEvent(repoName, EVENTS_DIR, { kind, agentId, payload }).catch(() => {});
}

// Helper: exitCode representativo de un run (0 si success, sino el del primer step fallido).
function runExitCode(run) {
    if (!run) return 1;
    if (run.status === 'success') return 0;
    const fail = (run.steps || []).find((s) => s && s.status === 'failure');
    return fail && typeof fail.exitCode === 'number' ? fail.exitCode : 1;
}

const actionsRouter = new APIRouter({
    prefix: '/repos',
    tags: ['Actions'],
    dependencies: { user: getCurrentUser }
});

// Helper: mapea ActionError/RepoError a respuesta REST con el status adecuado.
function actionErrorResponse(res, err) {
    if (err instanceof ActionError) {
        const status = err.code === 'not_found' ? 404
            : (err.code === 'invalid_workflow' || err.code === 'invalid_id') ? 400
            : 500;
        return res.json({ detail: 'ActionError', code: err.code, mensaje: err.message }, status);
    }
    if (err instanceof RepoError) {
        const status = err.code === 'invalid_name' ? 400 : 500;
        return res.json({ detail: 'RepoError', code: err.code, mensaje: err.message }, status);
    }
    return res.json({ detail: 'Error interno', mensaje: err.message }, 500);
}

// Helper: construye el ctx de actions (workflowsDir, runsDir, cwd del repo bare) para un repo.
// NOTA DE SEGURIDAD: los steps ejecutan shell ARBITRARIO por diseño (como GitHub Actions) y se
// ejecutan en el cwd del repo bare. Es ejecución LOCAL de confianza: no exponer a input no confiable.
function actionsCtx(repoName) {
    return {
        workflowsDir: WORKFLOWS_DIR,
        runsDir: RUNS_DIR,
        cwd: path.join(REPOS_DIR, repoName + '.git')
    };
}

// Definir/crear un workflow (POST /repos/:name/workflows) — body { name, trigger, steps }
actionsRouter.post('/:name/workflows', async (req, res) => {
    const body = req.body || {};
    if (typeof body.name !== 'string' || !body.name.trim()) {
        return res.json({ detail: 'Body inválido', mensaje: "'name' es obligatorio" }, 400);
    }
    if (!VALID_TRIGGERS.includes(body.trigger)) {
        return res.json({ detail: 'Body inválido', mensaje: "'trigger' debe ser uno de: " + VALID_TRIGGERS.join(', ') }, 400);
    }
    if (!Array.isArray(body.steps) || body.steps.length === 0) {
        return res.json({ detail: 'Body inválido', mensaje: "'steps' debe ser un array no vacío" }, 400);
    }
    try {
        const result = await saveWorkflow(req.params.name, WORKFLOWS_DIR, body);
        // Postal: emitir evento de memoria del workflow definido.
        emitActionEvent(req.params.name, 'workflow.defined', body.agent || 'system', {
            name: result.name, trigger: body.trigger
        });
        return { mensaje: 'Workflow definido', workflow: result };
    } catch (err) {
        return actionErrorResponse(res, err);
    }
}, {
    summary: 'Definir un workflow',
    description: 'Crea/reemplaza un workflow del repo. Body: { name, trigger: push|issue_opened|manual, steps: string[] | {command,name?}[] }.',
    body: {
        name: { type: 'string', required: true },
        trigger: { type: 'string', required: true },
        steps: { type: 'array', required: true }
    },
    dependencies: { user: requireAdmin }
});

// Listar workflows de un repo (GET /repos/:name/workflows)
actionsRouter.get('/:name/workflows', async (req, res) => {
    try {
        const workflows = await listWorkflows(req.params.name, WORKFLOWS_DIR);
        return { mensaje: 'Listado de workflows', total: workflows.length, workflows };
    } catch (err) {
        return actionErrorResponse(res, err);
    }
}, {
    summary: 'Listar workflows de un repo',
    description: 'Devuelve los workflows definidos para el repo.'
});

// Disparar un run manual (POST /repos/:name/workflows/:wf/dispatch) — body opcional { event }
actionsRouter.post('/:name/workflows/:wf/dispatch', async (req, res) => {
    const event = (req.body && typeof req.body.event === 'string' && req.body.event) ? req.body.event : 'manual';
    try {
        const run = await dispatchWorkflow(req.params.name, req.params.wf, event, actionsCtx(req.params.name));
        // Postal: emitir run.started y run.completed en SERIE (no compiten por el chain tip
        // del mismo agente). Fire-and-forget: no bloquea la respuesta ni rompe el dispatch.
        const agent = (req.body && req.body.agent) || 'system';
        const startedBody = { runId: run.id, workflow: run.workflow, event: run.event };
        const completedBody = {
            runId: run.id, workflow: run.workflow, event: run.event,
            status: run.status, exitCode: runExitCode(run)
        };
        emitActionEvent(req.params.name, 'run.started', agent, startedBody)
            .then(() => emitActionEvent(req.params.name, 'run.completed', agent, completedBody));
        return { mensaje: 'Workflow disparado', run };
    } catch (err) {
        return actionErrorResponse(res, err);
    }
}, {
    summary: 'Disparar (dispatch) un workflow',
    description: 'Ejecuta el workflow indicado y persiste el run. Body opcional: { event } (default: manual). Los steps se ejecutan en el cwd del repo (shell arbitrario, ejecución local de confianza).',
    dependencies: { user: requireAdmin }
});

// Listar runs de un repo (GET /repos/:name/runs)
actionsRouter.get('/:name/runs', async (req, res) => {
    try {
        const runs = await listRuns(req.params.name, RUNS_DIR);
        return { mensaje: 'Listado de runs', total: runs.length, runs };
    } catch (err) {
        return actionErrorResponse(res, err);
    }
}, {
    summary: 'Listar runs de un repo',
    description: 'Devuelve el historial de ejecuciones del repo.'
});

// Detalle/logs de un run (GET /repos/:name/runs/:runId)
actionsRouter.get('/:name/runs/:runId', async (req, res) => {
    try {
        const run = await getRun(req.params.name, RUNS_DIR, req.params.runId);
        return { mensaje: 'Run', run };
    } catch (err) {
        return actionErrorResponse(res, err);
    }
}, {
    summary: 'Obtener detalle/logs de un run',
    description: 'Devuelve el run con sus steps y la salida (stdout/stderr/exitCode) de cada uno.'
});

module.exports = actionsRouter;