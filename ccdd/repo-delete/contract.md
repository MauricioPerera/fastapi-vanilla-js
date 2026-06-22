---
task: repo-delete
intent: Borrar un repositorio bare local validando el nombre
target: ../../lib/gitRepos.js
language: javascript
signature: "async function deleteRepo(name, reposDir)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 2, lines_max: 15 }
deps_allowed: []
forbids: [eval]
tests: test_delete_repo.js
test_command: "node --test ../ccdd/repo-delete/test_delete_repo.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Borrar el repositorio bare `<reposDir>/<name>.git`, validando el nombre y fallando si no existe.

## Interface
- `deleteRepo(name: string, reposDir: string) -> Promise<{ name: string, deleted: boolean }>`
- Lanza `RepoError('not_found', ...)` si el repo no existe; `RepoError('invalid_name', ...)` si el nombre es inválido.
- Devuelve `{ name, deleted: true }` tras borrar.

## Invariants
- El nombre se valida con `sanitizeRepoName` antes de tocar el filesystem.
- Si el repo no existe, lanza sin modificar nada.
- Borra el directorio de forma recursiva (`fs.rm` con `recursive: true, force: true`).
- Tras el éxito, el directorio del repo ya no existe.

## Examples
- `deleteRepo('gone', <dir con gone.git>)` -> `{ name:'gone', deleted:true }` y el dir desaparece.
- `deleteRepo('nope', <dir>)` -> lanza `not_found`.
- `deleteRepo('../bad', <dir>)` -> lanza `invalid_name`.

## Do / Don't
- DO: validar el nombre antes del IO.
- DO: usar `fs.rm` recursivo.
- DON'T: borrar silenciosamente si no existe (debe lanzar).
- DON'T: escapar de `reposDir` (el nombre validado lo impide).

## Tests
Property-tests congelados en `ccdd/repo-delete/test_delete_repo.js` (oráculo independiente):
- Borra un repo existente y el dir desaparece.
- Lanza `not_found` si no existe.
- Lanza `invalid_name` para path traversal.

## Constraints
- Budget: cyclomatic ≤ 6, nesting ≤ 2, params ≤ 2, lines ≤ 15.
- `deps_allowed: []`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si borra un repo inexistente sin lanzar.