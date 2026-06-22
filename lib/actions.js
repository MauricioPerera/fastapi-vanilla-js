// lib/actions.js
// Motor de "Actions" estilo GitHub Actions, local y simple, para la alternativa-local-a-GitHub.
// Slice 3: definicion de workflows por repo + ejecucion de steps (shell) + persistencia de runs.
// Persistencia: workflows en <workflowsDir>/<repo>/<wfName>.json; runs en <runsDir>/<repo>/<runId>.json.
// Funciones puras (async) sobre fs + child_process.exec. Reusa sanitizeRepoName de gitRepos.
//
// SEGURIDAD: los steps ejecutan shell ARBITRARIO por diseno (como GitHub Actions). Se ejecutan
// en el cwd que el caller indique (tipicamente el repo/workspace). Es ejecucion LOCAL de confianza:
// NO exponer este motor a input no confiable. Los nombres de repo/workflow se sanitizan
// (sanitizeRepoName) para evitar path traversal; el comando del step SI permite cualquier shell
// (es el proposito). No hay inyeccion mas alla del propio step.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { sanitizeRepoName } = require('./gitRepos');

const VALID_TRIGGERS = ['push', 'issue_opened', 'manual', 'pull_request', 'pr_merged'];

class ActionError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

// --- Helpers internos (no son targets de contrato; cubiertos transitivamente) ---

function pathExists(p) {
    return fs.promises.access(p).then(() => true, () => false);
}

function workflowDir(repoName, workflowsDir) {
    return path.join(workflowsDir, repoName);
}

function runDir(repoName, runsDir) {
    return path.join(runsDir, repoName);
}

function workflowFile(repoName, workflowsDir, wfName) {
    return path.join(workflowDir(repoName, workflowsDir), wfName + '.json');
}

function runFile(repoName, runsDir, runId) {
    return path.join(runDir(repoName, runsDir), runId + '.json');
}

async function readJson(file) {
    const raw = await fs.promises.readFile(file, 'utf8');
    return JSON.parse(raw);
}

async function writeJson(file, obj) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
    await fs.promises.rename(tmp, file);
}

// Normaliza un step a { name, command }. Acepta string o { name?, command }. Devuelve null si invalido.
function normalizeStep(step) {
    if (typeof step === 'string') return { name: step, command: step };
    if (step && typeof step === 'object' && typeof step.command === 'string') {
        return { name: typeof step.name === 'string' ? step.name : step.command, command: step.command };
    }
    return null;
}

function genRunId() {
    return crypto.randomUUID();
}

function nowIso() {
    return new Date().toISOString();
}

// Valida un runId (UUID o slug alfanumerico con guiones) contra path traversal.
function sanitizeRunId(id) {
    if (typeof id !== 'string' || !id) throw new ActionError('invalid_id', 'runId inválido');
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new ActionError('invalid_id', 'runId inválido');
    return id;
}

// --- Funciones core (targets de contrato CCDD) ---

// Valida y normaliza los steps de un workflow (helper interno, no target de contrato).
function validateSteps(rawSteps) {
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) throw new ActionError('invalid_workflow', 'steps debe ser array no vacío');
    const steps = rawSteps.map(normalizeStep);
    if (steps.includes(null)) throw new ActionError('invalid_workflow', 'step inválido');
    return steps;
}

// Valida y normaliza una definicion de workflow. Lanza ActionError('invalid_workflow') si algo falla.
function validateWorkflow(raw) {
    if (!raw || typeof raw !== 'object') throw new ActionError('invalid_workflow', 'workflow requerido');
    if (typeof raw.name !== 'string' || !raw.name.trim()) throw new ActionError('invalid_workflow', 'name requerido');
    if (!VALID_TRIGGERS.includes(raw.trigger)) throw new ActionError('invalid_workflow', 'trigger inválido: ' + raw.trigger);
    return { name: raw.name.trim(), trigger: raw.trigger, steps: validateSteps(raw.steps) };
}

// Persiste un workflow validado en <workflowsDir>/<repo>/<wfName>.json. Devuelve { repo, name, path }.
async function saveWorkflow(repoName, workflowsDir, workflow) {
    const safeRepo = sanitizeRepoName(repoName);
    const wf = validateWorkflow(workflow);
    const safeName = sanitizeRepoName(wf.name);
    const file = workflowFile(safeRepo, workflowsDir, safeName);
    await writeJson(file, { name: safeName, trigger: wf.trigger, steps: wf.steps });
    return { repo: safeRepo, name: safeName, path: file };
}

// Lista los workflows de un repo (JSON parseados), ordenados por nombre. Devuelve [] si no hay dir.
async function listWorkflows(repoName, workflowsDir) {
    const safeRepo = sanitizeRepoName(repoName);
    const dir = workflowDir(safeRepo, workflowsDir);
    if (!await pathExists(dir)) return [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const found = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
            found.push(await readJson(path.join(dir, entry.name)));
        } catch (e) { /* skip corrupt */ }
    }
    return found.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// Filtra workflows cuyo trigger coincide con event. Pure. Devuelve [] si inputs invalidos.
function selectWorkflowsByEvent(workflows, event) {
    if (!Array.isArray(workflows)) return [];
    if (typeof event !== 'string' || !event) return [];
    return workflows.filter((w) => w && w.trigger === event);
}

// Ejecuta un step (shell) en cwd. Devuelve { name, command, status, stdout, stderr, exitCode }.
function runStep(step, cwd) {
    const norm = normalizeStep(step);
    if (norm === null) {
        return Promise.resolve({ name: '', command: '', status: 'failure', stdout: '', stderr: 'step inválido', exitCode: 1 });
    }
    return new Promise((resolve) => {
        exec(norm.command, { cwd }, (err, stdout, stderr) => {
            const exitCode = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
            const status = err ? 'failure' : 'success';
            resolve({ name: norm.name, command: norm.command, status, stdout: stdout.toString(), stderr: stderr ? stderr.toString() : '', exitCode });
        });
    });
}

// Ejecuta los steps de un workflow secuencialmente (para al primer fallo). Devuelve el run record.
async function runWorkflow(workflow, event, cwd) {
    const wf = validateWorkflow(workflow);
    const runId = genRunId();
    const startedAt = nowIso();
    const steps = [];
    let status = 'success';
    for (const step of wf.steps) {
        const t0 = nowIso();
        const res = await runStep(step, cwd);
        res.startedAt = t0;
        res.finishedAt = nowIso();
        steps.push(res);
        if (res.status === 'failure') { status = 'failure'; break; }
    }
    return { id: runId, workflow: wf.name, event, status, startedAt, finishedAt: nowIso(), steps };
}

// Dispara un workflow por nombre: lo carga, ejecuta, persiste el run. Devuelve el run.
async function dispatchWorkflow(repoName, wfName, event, ctx) {
    const safeRepo = sanitizeRepoName(repoName);
    const safeName = sanitizeRepoName(wfName);
    const file = workflowFile(safeRepo, ctx.workflowsDir, safeName);
    if (!await pathExists(file)) throw new ActionError('not_found', 'workflow no existe: ' + safeName);
    const wf = await readJson(file);
    const run = await runWorkflow(wf, event, ctx.cwd);
    await writeJson(runFile(safeRepo, ctx.runsDir, run.id), run);
    return run;
}

// Dispara todos los workflows de un repo cuyo trigger coincide con event. Devuelve array de runs.
async function dispatchEvent(repoName, event, ctx) {
    const safeRepo = sanitizeRepoName(repoName);
    const workflows = await listWorkflows(safeRepo, ctx.workflowsDir);
    const matched = selectWorkflowsByEvent(workflows, event);
    const runs = [];
    for (const wf of matched) {
        const run = await runWorkflow(wf, event, ctx.cwd);
        await writeJson(runFile(safeRepo, ctx.runsDir, run.id), run);
        runs.push(run);
    }
    return runs;
}

// Lista los runs de un repo (JSON parseados), ordenados por id. Devuelve [] si no hay dir.
async function listRuns(repoName, runsDir) {
    const safeRepo = sanitizeRepoName(repoName);
    const dir = runDir(safeRepo, runsDir);
    if (!await pathExists(dir)) return [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const found = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
            found.push(await readJson(path.join(dir, entry.name)));
        } catch (e) { /* skip corrupt */ }
    }
    return found.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// Obtiene un run por id. Lanza ActionError('not_found') si no existe, ('invalid_id') si id invalido.
async function getRun(repoName, runsDir, runId) {
    const safeRepo = sanitizeRepoName(repoName);
    const safeId = sanitizeRunId(runId);
    const file = runFile(safeRepo, runsDir, safeId);
    if (!await pathExists(file)) throw new ActionError('not_found', 'run no existe: ' + safeId);
    return readJson(file);
}

module.exports = {
    ActionError,
    VALID_TRIGGERS,
    validateWorkflow,
    saveWorkflow,
    listWorkflows,
    selectWorkflowsByEvent,
    runStep,
    runWorkflow,
    dispatchWorkflow,
    dispatchEvent,
    listRuns,
    getRun
};