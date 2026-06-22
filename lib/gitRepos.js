// lib/gitRepos.js
// Gestión local de repositorios git bare para la alternativa-local-a-GitHub.
// Slice 1: crear / listar / info (ramas + último commit) / borrar.
// Funciones puras (async) sobre child_process.execFile('git', ...). Sin dependencias externas.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Patrón de nombre seguro: alfanumérico inicial, hasta 63 chars, permite . _ - en el resto.
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

class RepoError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

// --- Helpers internos (no son targets de contrato; cubiertos transitivamente) ---

function pathExists(p) {
    return fs.promises.access(p).then(() => true, () => false);
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

async function isBareRepo(dir) {
    try {
        await fs.promises.access(path.join(dir, 'HEAD'));
        return true;
    } catch (e) {
        return false;
    }
}

// --- Funciones core (targets de contrato CCDD) ---

// Sanitiza y valida el nombre de un repo. Guarda contra path traversal y nombres malformados.
function sanitizeRepoName(name) {
    if (typeof name !== 'string') throw new RepoError('invalid_name', 'el nombre debe ser string');
    const trimmed = name.trim();
    if (!trimmed) throw new RepoError('invalid_name', 'nombre vacío');
    if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
        throw new RepoError('invalid_name', 'nombre contiene caracteres prohibidos');
    }
    if (!NAME_RE.test(trimmed)) throw new RepoError('invalid_name', 'nombre inválido');
    return trimmed;
}

// Crea un repo bare en <reposDir>/<name>.git. Lanza si ya existe o el nombre es inválido.
async function createBareRepo(name, reposDir) {
    const safe = sanitizeRepoName(name);
    const repoPath = path.join(reposDir, safe + '.git');
    if (await pathExists(repoPath)) throw new RepoError('exists', 'repo ya existe: ' + safe);
    await fs.promises.mkdir(reposDir, { recursive: true });
    await gitExec(['init', '--bare', repoPath]);
    return { name: safe, path: repoPath };
}

// Lista los repos bare (.git con HEAD) bajo reposDir, ordenados por nombre.
async function listRepos(reposDir) {
    if (!await pathExists(reposDir)) return [];
    const entries = await fs.promises.readdir(reposDir, { withFileTypes: true });
    const found = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.endsWith('.git')) continue;
        const dir = path.join(reposDir, entry.name);
        if (await isBareRepo(dir)) found.push({ name: entry.name.slice(0, -4), path: dir });
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
}

// Parsea la salida de `git branch --format=%(refname:short)` a un array de nombres de rama.
function parseBranchesOutput(stdout) {
    return stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

// Parsea la salida de `git log -1 --format=%H|%an|%aI|%s` a un objeto commit o null.
function parseLastCommitOutput(stdout) {
    const line = stdout.trim();
    if (!line) return null;
    const parts = line.split('|');
    if (parts.length < 4) return null;
    return { hash: parts[0], author: parts[1], date: parts[2], message: parts.slice(3).join('|') };
}

// Obtiene info de un repo: ramas y último commit (null si no hay commits).
async function getRepoInfo(name, reposDir) {
    const safe = sanitizeRepoName(name);
    const repoPath = path.join(reposDir, safe + '.git');
    if (!await pathExists(repoPath)) throw new RepoError('not_found', 'repo no existe: ' + safe);
    const branchOut = await gitExec(['branch', '--format=%(refname:short)'], repoPath);
    const branches = parseBranchesOutput(branchOut);
    let lastCommit = null;
    try {
        const logOut = await gitExec(['log', '-1', '--format=%H|%an|%aI|%s'], repoPath);
        lastCommit = parseLastCommitOutput(logOut);
    } catch (e) {
        lastCommit = null;
    }
    return { name: safe, path: repoPath, branches, lastCommit };
}

// Borra un repo bare. Lanza si no existe.
async function deleteRepo(name, reposDir) {
    const safe = sanitizeRepoName(name);
    const repoPath = path.join(reposDir, safe + '.git');
    if (!await pathExists(repoPath)) throw new RepoError('not_found', 'repo no existe: ' + safe);
    await fs.promises.rm(repoPath, { recursive: true, force: true });
    return { name: safe, deleted: true };
}

module.exports = {
    RepoError,
    sanitizeRepoName,
    createBareRepo,
    listRepos,
    parseBranchesOutput,
    parseLastCommitOutput,
    getRepoInfo,
    deleteRepo
};