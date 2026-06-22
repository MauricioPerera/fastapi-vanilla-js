const { APIRouter } = require('../lib/fastapi');
const path = require('path');
const {
    createBareRepo,
    listRepos,
    getRepoInfo,
    deleteRepo,
    RepoError
} = require('../lib/gitRepos');
const { getCurrentUser } = require('../dependencies/auth');

// Directorio base donde se guardan los repos bare. .data/ ya está en .gitignore.
const REPOS_DIR = path.join(__dirname, '..', '.data', 'repos');

// HARDENING: todo endpoint (GET + escritura) exige token Bearer via getCurrentUser.
// Reusa dependencies/auth.js (mismo patron que routers/items.js). Sin token -> 401.
const reposRouter = new APIRouter({
    prefix: '/repos',
    tags: ['Repos'],
    dependencies: { user: getCurrentUser }
});

// Helper: mapea RepoError a una respuesta REST con el status adecuado.
function repoErrorResponse(res, err) {
    if (err instanceof RepoError) {
        const status = err.code === 'not_found' ? 404
            : err.code === 'exists' ? 409
            : err.code === 'invalid_name' ? 400
            : 500;
        return res.json({ detail: 'RepoError', code: err.code, mensaje: err.message }, status);
    }
    return res.json({ detail: 'Error interno', mensaje: err.message }, 500);
}

// Crear repo (POST /repos) — body { name }
reposRouter.post('/', async (req, res) => {
    const name = req.body && req.body.name;
    if (!name) return res.json({ detail: 'Body inválido', mensaje: "'name' es obligatorio" }, 400);
    try {
        const repo = await createBareRepo(name, REPOS_DIR);
        return { mensaje: 'Repo creado', repo };
    } catch (err) {
        return repoErrorResponse(res, err);
    }
}, {
    summary: 'Crear repositorio bare',
    description: 'Crea un repo git bare local con `git init --bare`. Body: { name: string }.',
    body: {
        name: { type: 'string', required: true }
    }
});

// Listar repos (GET /repos)
reposRouter.get('/', async (req, res) => {
    try {
        const repos = await listRepos(REPOS_DIR);
        return { mensaje: 'Listado de repos', total: repos.length, repos };
    } catch (err) {
        return repoErrorResponse(res, err);
    }
}, {
    summary: 'Listar repositorios',
    description: 'Devuelve los repos bare existentes ordenados por nombre.'
});

// Info de un repo (GET /repos/:name)
reposRouter.get('/:name', async (req, res) => {
    try {
        const info = await getRepoInfo(req.params.name, REPOS_DIR);
        return { mensaje: 'Info del repo', info };
    } catch (err) {
        return repoErrorResponse(res, err);
    }
}, {
    summary: 'Obtener info de un repo',
    description: 'Devuelve ramas y último commit del repo bare.'
});

// Borrar repo (DELETE /repos/:name)
reposRouter.delete('/:name', async (req, res) => {
    try {
        const result = await deleteRepo(req.params.name, REPOS_DIR);
        return { mensaje: 'Repo borrado', result };
    } catch (err) {
        return repoErrorResponse(res, err);
    }
}, {
    summary: 'Borrar repositorio',
    description: 'Borra el repo bare indicado.'
});

module.exports = reposRouter;