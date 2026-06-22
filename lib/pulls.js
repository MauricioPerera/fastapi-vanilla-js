// lib/pulls.js
// Gestión local de Pull Requests para la alternativa-local-a-GitHub.
// Slice 4: crear / listar / obtener PR; commits + diff; estado (close/reopen); merge real;
// comentarios. Persistencia: un JSON por repo en <pullsDir>/<name>.json (patrón de issues).
// Merge real sobre el repo bare vía worktree temporal (zero-dep). Reusa sanitizeRepoName.
//
// Funciones core (targets de contrato CCDD) — ver ccdd/pr-*.
// Helpers internos (pathExists, storePath, readStore, writeStore, findPull, nowIso, gitExec)
// no son targets de contrato: cubiertos transitivamente por los gates de create/list/get/state/merge.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { sanitizeRepoName, RepoError } = require('./gitRepos');

const VALID_STATES = ['open', 'closed', 'merged'];

class PullError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

// --- Helpers internos (no son targets de contrato) ---

function pathExists(p) {
    return fs.promises.access(p).then(() => true, () => false);
}

function storePath(repoName, pullsDir) {
    return path.join(pullsDir, repoName + '.json');
}

async function readStore(repoName, pullsDir) {
    const file = storePath(repoName, pullsDir);
    if (!await pathExists(file)) return { repo: repoName, nextNumber: 1, pulls: [] };
    const raw = await fs.promises.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.pulls) parsed.pulls = [];
    if (typeof parsed.nextNumber !== 'number') parsed.nextNumber = parsed.pulls.length + 1;
    parsed.repo = repoName;
    return parsed;
}

async function writeStore(repoName, pullsDir, store) {
    const file = storePath(repoName, pullsDir);
    await fs.promises.mkdir(pullsDir, { recursive: true });
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
    await fs.promises.rename(tmp, file);
}

function findPull(store, number) {
    const pull = store.pulls.find((p) => p.number === number);
    if (!pull) throw new PullError('not_found', 'PR no existe: #' + number);
    return pull;
}

function nowIso() {
    return new Date().toISOString();
}

function gitExec(args, cwd) {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd: cwd || undefined, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                err.stderr = stderr ? stderr.toString() : '';
                reject(err);
            } else {
                resolve(stdout.toString());
            }
        });
    });
}

// --- Funciones core (targets de contrato CCDD) ---

function _isInvalidChar(char) {
    return char === ':' || char === '~' || char === '^' || char === '?' ||
           char === '*' || char === '[' || char === ']' || char === '{' ||
           char === '}' || char === '(' || char === ')' || char === ',' ||
           char === '@' || char === '\\' || char === '"' || char === "'" ||
           char === ' ' || char === '\0';
}

function _hasInvalidPatterns(name) {
    return name.includes('..') || name[0] === '-' || name.length > 200;
}

function sanitizeBranchName(name) {
    if (typeof name !== 'string') throw new PullError('invalid_branch');

    const trimmed = name.trim();
    if (!trimmed) throw new PullError('invalid_branch');

    if (_hasInvalidPatterns(trimmed)) throw new PullError('invalid_branch');

    for (let i = 0; i < trimmed.length; i++) {
        if (_isInvalidChar(trimmed[i])) throw new PullError('invalid_branch');
    }

    return trimmed;
}

// parseCommitsOutput(stdout) — stub (contrato pr-parse-commits).
function parseCommitsOutput(stdout) {
    if (!stdout) return [];
    
    const lines = stdout.split('\n');
    const commits = [];
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        const parts = line.split('|');
        if (parts.length < 4) continue;
        
        const [hash, author, date, ...messageParts] = parts;
        commits.push({
            hash: hash.trim(),
            author: author.trim(),
            date: date.trim(),
            message: messageParts.join('|').trim()
        });
    }
    
    return commits;
}

// parseDiffStatOutput(stdout) — stub (contrato pr-parse-diff-stat).
function parseDiffStatOutput(stdout) {
    if (!stdout) {
        return { files: [], totalAdditions: 0, totalDeletions: 0, filesChanged: 0 };
    }

    const lines = stdout.split('\n');
    const files = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;

        const [additionsStr, deletionsStr, file] = parts;
        const additions = additionsStr === '-' ? 0 : Number(additionsStr);
        const deletions = deletionsStr === '-' ? 0 : Number(deletionsStr);

        files.push({ file, additions, deletions });
        totalAdditions += additions;
        totalDeletions += deletions;
    }

    return {
        files,
        totalAdditions,
        totalDeletions,
        filesChanged: files.length
    };
}

// validateBranchesExist(repoPath, head, base) — contrato pr-validate-branches.
async function validateBranchesExist(repoPath, head, base) {
    const safeHead = sanitizeBranchName(head);
    const safeBase = sanitizeBranchName(base);
    try { await gitExec(['show-ref', '--verify', '--quiet', 'refs/heads/' + safeHead], repoPath); }
    catch (e) { throw new PullError('branch_not_found', 'rama head no existe: ' + safeHead); }
    try { await gitExec(['show-ref', '--verify', '--quiet', 'refs/heads/' + safeBase], repoPath); }
    catch (e) { throw new PullError('branch_not_found', 'rama base no existe: ' + safeBase); }
    return { head: safeHead, base: safeBase };
}

// validatePullData(data) — contrato pr-validate-pull-data.
function validatePullData(data) {
    if (!data || typeof data !== 'object') throw new PullError('invalid_body', 'data requerido');
    for (const f of ['title', 'head', 'base']) {
        if (typeof data[f] !== 'string' || !data[f].trim()) throw new PullError('invalid_body', f + ' requerido');
    }
    return { title: data.title.trim(), head: data.head, base: data.base };
}

// createPull(repoName, pullsDir, data) — contrato pr-create.
async function createPull(repoName, pullsDir, data) {
    const safeRepo = sanitizeRepoName(repoName);
    const { title, head: rawHead, base: rawBase } = validatePullData(data);
    const head = sanitizeBranchName(rawHead);
    const base = sanitizeBranchName(rawBase);
    const store = await readStore(safeRepo, pullsDir);
    const number = store.nextNumber;
    const ts = nowIso();
    const body = typeof data.body === 'string' ? data.body : '';
    const pull = { number, title, body, head, base, state: 'open', createdAt: ts, updatedAt: ts, mergeCommitSha: null, mergedAt: null, comments: [] };
    store.pulls.push(pull);
    store.nextNumber = number + 1;
    await writeStore(safeRepo, pullsDir, store);
    return pull;
}

// listPulls(repoName, pullsDir, stateFilter) — contrato pr-list.
async function listPulls(repoName, pullsDir, stateFilter) {
    const safeRepo = sanitizeRepoName(repoName);
    const store = await readStore(safeRepo, pullsDir);
    if (stateFilter && stateFilter !== 'all') {
        if (!VALID_STATES.includes(stateFilter)) throw new PullError('invalid_state', 'estado inválido: ' + stateFilter);
        return store.pulls.filter((p) => p.state === stateFilter);
    }
    return store.pulls.slice();
}

// getPull(repoName, pullsDir, number) — contrato pr-get.
async function getPull(repoName, pullsDir, number) {
    const safeRepo = sanitizeRepoName(repoName);
    const store = await readStore(safeRepo, pullsDir);
    return findPull(store, number);
}

// setPullState(repoName, pullsDir, number, state) — contrato pr-state.
async function setPullState(repoName, pullsDir, number, state) {
    if (state !== 'open' && state !== 'closed') throw new PullError('invalid_state', 'estado inválido: ' + state);
    const safeRepo = sanitizeRepoName(repoName);
    const store = await readStore(safeRepo, pullsDir);
    const pull = findPull(store, number);
    pull.state = state;
    pull.updatedAt = nowIso();
    await writeStore(safeRepo, pullsDir, store);
    return pull;
}

// addPullComment(repoName, pullsDir, number, data) — contrato pr-comment-add.
async function addPullComment(repoName, pullsDir, number, data) {
    if (!data || typeof data !== 'object') throw new PullError('invalid_body', 'data requerido');
    if (typeof data.body !== 'string' || !data.body.trim()) throw new PullError('invalid_body', 'body requerido');
    const safeRepo = sanitizeRepoName(repoName);
    const store = await readStore(safeRepo, pullsDir);
    const pull = findPull(store, number);
    const comment = { author: typeof data.author === 'string' ? data.author : 'anonymous', body: data.body, createdAt: nowIso() };
    pull.comments.push(comment);
    pull.updatedAt = comment.createdAt;
    await writeStore(safeRepo, pullsDir, store);
    return comment;
}

// listPullComments(repoName, pullsDir, number) — contrato pr-comment-list.
async function listPullComments(repoName, pullsDir, number) {
    const safeRepo = sanitizeRepoName(repoName);
    const store = await readStore(safeRepo, pullsDir);
    const pull = findPull(store, number);
    return pull.comments.slice();
}

// getPrCommits(repoPath, head, base) — contrato pr-commits.
async function getPrCommits(repoPath, head, base) {
    const safeHead = sanitizeBranchName(head);
    const safeBase = sanitizeBranchName(base);
    const out = await gitExec(['log', '--format=%H|%an|%aI|%s', safeBase + '..' + safeHead], repoPath);
    return parseCommitsOutput(out);
}

// getPrDiffStat(repoPath, head, base) — contrato pr-diff-stat.
async function getPrDiffStat(repoPath, head, base) {
    const safeHead = sanitizeBranchName(head);
    const safeBase = sanitizeBranchName(base);
    const out = await gitExec(['diff', '--numstat', safeBase + '...' + safeHead], repoPath);
    return parseDiffStatOutput(out);
}

// mergeBranches(repoPath, base, head) — contrato pr-merge-branches.
async function mergeBranches(repoPath, base, head) {
    const safeBase = sanitizeBranchName(base);
    const safeHead = sanitizeBranchName(head);
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'prmerge-'));
    try {
        await gitExec(['worktree', 'add', tmp, safeBase], repoPath);
        await gitExec(['-c', 'user.name=local-merge', '-c', 'user.email=merge@local', 'merge', '--no-edit', safeHead], tmp);
        const sha = (await gitExec(['rev-parse', 'HEAD'], tmp)).trim();
        return { mergeCommitSha: sha };
    } catch (e) {
        throw new PullError('merge_conflict', 'conflicto de merge: ' + safeHead + ' -> ' + safeBase);
    } finally {
        await gitExec(['worktree', 'remove', '--force', tmp], repoPath).catch(() => {});
        await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
}

// mergePull(repoName, pullsDir, repoPath, number) — contrato pr-merge.
async function mergePull(repoName, pullsDir, repoPath, number) {
    const safeRepo = sanitizeRepoName(repoName);
    const store = await readStore(safeRepo, pullsDir);
    const pull = findPull(store, number);
    if (pull.state !== 'open') throw new PullError('invalid_state', 'solo PRs abiertos pueden mergearse');
    const { mergeCommitSha } = await mergeBranches(repoPath, pull.base, pull.head);
    pull.state = 'merged';
    pull.mergeCommitSha = mergeCommitSha;
    pull.mergedAt = nowIso();
    pull.updatedAt = pull.mergedAt;
    await writeStore(safeRepo, pullsDir, store);
    return pull;
}

module.exports = {
    PullError,
    VALID_STATES,
    sanitizeBranchName,
    parseCommitsOutput,
    parseDiffStatOutput,
    validatePullData,
    validateBranchesExist,
    createPull,
    listPulls,
    getPull,
    setPullState,
    addPullComment,
    listPullComments,
    getPrCommits,
    getPrDiffStat,
    mergeBranches,
    mergePull
};