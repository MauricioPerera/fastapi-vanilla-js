---
task: repo-create-bare
intent: Crear un repositorio git bare local con nombre validado
target: ../../lib/gitRepos.js
language: javascript
signature: "async function createBareRepo(name, reposDir)"
budget: { cyclomatic_max: 8, nesting_max: 2, params_max: 2, lines_max: 20 }
deps_allowed: []
forbids: [eval]
tests: test_create_bare_repo.js
test_command: "node --test ../ccdd/repo-create-bare/test_create_bare_repo.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Crear un repositorio git bare en `<reposDir>/<name>.git`, validando el nombre y fallando si ya existe, usando el binario `git` del sistema.

## Interface
- `createBareRepo(name: string, reposDir: string) -> Promise<{ name: string, path: string }>`
- `name`: nombre del repo (se sanitiza vía `sanitizeRepoName`).
- `reposDir`: directorio base; se crea si no existe.
- Devuelve `{ name, path }` donde `path` es la ruta al bare repo.
- Lanza `RepoError('exists', ...)` si el repo ya existe; `RepoError('invalid_name', ...)` si el nombre es inválido.

## Invariants
- El nombre se valida con `sanitizeRepoName` antes de tocar el filesystem.
- El bare repo se materializa con `git init --bare <path>` (vía `child_process.execFile`).
- Si el repo ya existe, lanza sin modificar nada.
- `reposDir` se crea con `recursive: true` (idempotente).
- El resultado `path` termina en `<name>.git`.

## Examples
- `createBareRepo('mi-repo', <tmpdir>)` -> `{ name: 'mi-repo', path: '<tmpdir>/mi-repo.git' }` y existe `<path>/HEAD`.
- `createBareRepo('dup', <dir con dup.git>)` -> lanza `exists`.
- `createBareRepo('../bad', <tmpdir>)` -> lanza `invalid_name`.

## Do / Don't
- DO: validar el nombre antes de cualquier IO.
- DO: crear `reposDir` con `recursive: true`.
- DON'T: sobrescribir un repo existente.
- DON'T: usar `exec`/shell; usar `execFile` con args como array.

## Tests
Property-tests congelados en `ccdd/repo-create-bare/test_create_bare_repo.js` (oráculo independiente, usa `child_process` directo y `os.tmpdir()`):
- Crea un bare repo y existe `HEAD`.
- Rechaza nombre inválido (path traversal).
- Rechaza duplicado.
- Limpia el tempdir en cada caso.

## Constraints
- Budget: cyclomatic ≤ 8, nesting ≤ 2, params ≤ 2, lines ≤ 20.
- `deps_allowed: []` (builtins only); `forbids: [eval]` (subprocess via execFile permitido).
- PARAR y reportar si el gate excede el budget o si crea un repo sin `HEAD`.