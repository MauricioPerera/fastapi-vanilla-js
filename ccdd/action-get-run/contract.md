---
task: action-get-run
intent: Obtener un run por su id
target: ../../lib/actions.js
language: javascript
signature: "async function getRun(repoName, runsDir, runId)"
budget: { cyclomatic_max: 4, nesting_max: 2, params_max: 3, lines_max: 10 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_get_run.js
test_command: "node --test ../ccdd/action-get-run/test_get_run.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Obtener el run persistido de un repo por su id, validando el id contra path traversal.

## Interface
- `getRun(repoName, runsDir, runId) -> Promise<run>`
- Lanza `ActionError('invalid_id')` si `runId` no es string alfanumérico con guiones (≤64).
- Lanza `ActionError('not_found')` si el run no existe.
- Lanza `RepoError('invalid_name')` si `repoName` es inválido.

## Invariants
- `runId` solo permite `[a-zA-Z0-9-]` (sin `/`, `..`, espacios).
- El run se lee de `<runsDir>/<repo>/<runId>.json`.
- Si el archivo no existe, lanza `not_found`.

## Examples
- `getRun('r', <dir>, 'run-1')` con `run-1.json` presente -> devuelve el run.
- `getRun('r', <dir>, 'missing')` -> lanza `not_found`.
- `getRun('r', <dir>, '../x')` -> lanza `invalid_id`.

## Do / Don't
- DO: validar `runId` antes de tocar el filesystem.
- DO: lanzar `not_found` si el run no existe.
- DON'T: permitir path traversal en `runId`.

## Tests
Property-tests congelados en `ccdd/action-get-run/test_get_run.js` (oráculo independiente: escribe el run con fs directo):
- Run existente se devuelve.
- Run inexistente lanza `not_found`.
- `runId` con path traversal lanza `invalid_id`.
- `runId` vacío lanza `invalid_id`.

## Constraints
- Budget: cyclomatic ≤ 4, nesting ≤ 2, params ≤ 3, lines ≤ 10.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si permite path traversal en `runId`.