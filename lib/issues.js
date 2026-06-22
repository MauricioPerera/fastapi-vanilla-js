// lib/issues.js
// Gestión local de issues para la alternativa-local-a-GitHub.
// Slice 2: CRUD de issues + comentarios asociados a un repo existente.
// Persistencia: un JSON por repo en <issuesDir>/<name>.json (patrón filesystem del Slice 1).
// Funciones puras (async) sobre fs. Sin dependencias externas. Reusa sanitizeRepoName de gitRepos.

const fs = require('fs');
const path = require('path');
const { sanitizeRepoName, RepoError } = require('./gitRepos');

const VALID_STATES = ['open', 'closed'];

class IssueError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

// --- Helpers internos (no son targets de contrato; cubiertos transitivamente) ---

function pathExists(p) {
    return fs.promises.access(p).then(() => true, () => false);
}

function storePath(repoName, issuesDir) {
    return path.join(issuesDir, repoName + '.json');
}

// Lee el store de un repo. Si no existe, devuelve un store vacío (sin tocar disco).
async function readStore(repoName, issuesDir) {
    const file = storePath(repoName, issuesDir);
    if (!await pathExists(file)) return { repo: repoName, nextNumber: 1, issues: [] };
    const raw = await fs.promises.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.issues) parsed.issues = [];
    if (typeof parsed.nextNumber !== 'number') parsed.nextNumber = parsed.issues.length + 1;
    parsed.repo = repoName;
    return parsed;
}

// Escribe el store atómicamente (temp + rename).
async function writeStore(repoName, issuesDir, store) {
    const file = storePath(repoName, issuesDir);
    await fs.promises.mkdir(issuesDir, { recursive: true });
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
    await fs.promises.rename(tmp, file);
}

// Busca un issue por número dentro del store. Lanza not_found si no existe.
function findIssue(store, number) {
    const issue = store.issues.find((i) => i.number === number);
    if (!issue) throw new IssueError('not_found', 'issue no existe: #' + number);
    return issue;
}

function nowIso() {
    return new Date().toISOString();
}

function coerceLabels(labels) {
    if (labels === undefined || labels === null) return [];
    if (!Array.isArray(labels)) throw new IssueError('invalid_body', 'labels debe ser array');
    return labels.map((l) => String(l)).filter((l) => l.length > 0);
}

// --- Funciones core (targets de contrato CCDD) ---

// Crea un issue en el repo con título/body/labels; número autoincremental, estado open.
async function createIssue(repoName, issuesDir, data) {
    const safe = sanitizeRepoName(repoName);
    if (!data || typeof data !== 'object') throw new IssueError('invalid_body', 'data requerido');
    if (typeof data.title !== 'string' || !data.title.trim()) throw new IssueError('invalid_body', 'title requerido');
    const store = await readStore(safe, issuesDir);
    const number = store.nextNumber;
    const ts = nowIso();
    const issue = {
        number,
        title: data.title.trim(),
        body: typeof data.body === 'string' ? data.body : '',
        labels: coerceLabels(data.labels),
        state: 'open',
        createdAt: ts,
        updatedAt: ts,
        comments: []
    };
    store.issues.push(issue);
    store.nextNumber = number + 1;
    await writeStore(safe, issuesDir, store);
    return issue;
}

// Lista los issues de un repo, opcionalmente filtrados por estado ('open'|'closed'|'all').
async function listIssues(repoName, issuesDir, stateFilter) {
    const safe = sanitizeRepoName(repoName);
    const store = await readStore(safe, issuesDir);
    if (stateFilter && stateFilter !== 'all' && !VALID_STATES.includes(stateFilter)) {
        throw new IssueError('invalid_state', 'estado inválido: ' + stateFilter);
    }
    if (!stateFilter || stateFilter === 'all') return store.issues.slice();
    return store.issues.filter((i) => i.state === stateFilter);
}

// Obtiene un issue por su número. Lanza not_found si no existe.
async function getIssue(repoName, issuesDir, number) {
    const safe = sanitizeRepoName(repoName);
    const store = await readStore(safe, issuesDir);
    return findIssue(store, number);
}

// Actualiza título/body/labels de un issue (solo los campos presentes en patch). Devuelve el issue.
async function updateIssue(repoName, issuesDir, number, patch) {
    const safe = sanitizeRepoName(repoName);
    const store = await readStore(safe, issuesDir);
    const issue = findIssue(store, number);
    if (!patch || typeof patch !== 'object') throw new IssueError('invalid_body', 'patch requerido');
    if (patch.title !== undefined) {
        if (typeof patch.title !== 'string' || !patch.title.trim()) throw new IssueError('invalid_body', 'title inválido');
        issue.title = patch.title.trim();
    }
    if (patch.body !== undefined) issue.body = typeof patch.body === 'string' ? patch.body : '';
    if (patch.labels !== undefined) issue.labels = coerceLabels(patch.labels);
    issue.updatedAt = nowIso();
    await writeStore(safe, issuesDir, store);
    return issue;
}

// Cierra/reabre un issue estableciendo su estado. Lanza invalid_state si state no es válido.
async function setIssueState(repoName, issuesDir, number, state) {
    const safe = sanitizeRepoName(repoName);
    if (!VALID_STATES.includes(state)) throw new IssueError('invalid_state', 'estado inválido: ' + state);
    const store = await readStore(safe, issuesDir);
    const issue = findIssue(store, number);
    issue.state = state;
    issue.updatedAt = nowIso();
    await writeStore(safe, issuesDir, store);
    return issue;
}

// Añade un comentario a un issue. Lanza invalid_body si body está vacío. Devuelve el comentario.
async function addComment(repoName, issuesDir, number, data) {
    const safe = sanitizeRepoName(repoName);
    if (!data || typeof data !== 'object') throw new IssueError('invalid_body', 'data requerido');
    if (typeof data.body !== 'string' || !data.body.trim()) throw new IssueError('invalid_body', 'body requerido');
    const store = await readStore(safe, issuesDir);
    const issue = findIssue(store, number);
    const comment = {
        author: typeof data.author === 'string' ? data.author : 'anonymous',
        body: data.body,
        createdAt: nowIso()
    };
    issue.comments.push(comment);
    issue.updatedAt = comment.createdAt;
    await writeStore(safe, issuesDir, store);
    return comment;
}

// Lista los comentarios de un issue. Lanza not_found si el issue no existe.
async function listComments(repoName, issuesDir, number) {
    const safe = sanitizeRepoName(repoName);
    const store = await readStore(safe, issuesDir);
    const issue = findIssue(store, number);
    return issue.comments.slice();
}

module.exports = {
    IssueError,
    VALID_STATES,
    createIssue,
    listIssues,
    getIssue,
    updateIssue,
    setIssueState,
    addComment,
    listComments
};