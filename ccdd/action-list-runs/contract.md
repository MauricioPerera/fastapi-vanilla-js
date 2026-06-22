---
task: action-list-runs
intent: Listar los runs de un repo
target: ../../lib/actions.js
language: javascript
signature: "async function listRuns(repoName, runsDir)"
budget: { cyclomatic_max: 7, nesting_max: 2, params_max: 2, lines_max: 18 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_list_runs.js
test_command: "node --test ../ccdd/action-list-runs/test_list_runs.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Listar los runs persistidos de un repo, devolviendo los JSON parseados ordenados por id.

## Interface
- `listRuns(repoName, runsDir) -> Promise<object[]>`
- Sanitiza `repoName` con `sanitizeRepoName`.
- Devuelve `[]` si el directorio del repo no existe.

## Invariants
- Solo se leen archivos `.json`.
- Archivos corruptos se ignoran sin lanzar.
- El resultado está ordenado por `id` ascendente (localeCompare).

## Examples
- Repo sin runs -> `[]`.
- Repo con dos runs -> array de 2 runs ordenados por id.
- `listRuns('../bad', <dir>)` -> lanza `invalid_name`.

## Do / Don't
- DO: ignorar archivos no-JSON y JSON corruptos.
- DO: ordenar por id.
- DON'T: lanzar si el directorio no existe.

## Tests
Property-tests congelados en `ccdd/action-list-runs/test_list_runs.js` (oráculo independiente: escribe runs con fs directo):
- Repo sin dir -> `[]`.
- Devuelve runs ordenados por id.
- Ignora archivos no-JSON.
- Path traversal lanza `invalid_name`.

## Constraints
- Budget: cyclomatic ≤ 7, nesting ≤ 2, params ≤ 2, lines ≤ 18.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si lanza en lugar de devolver `[]` cuando el dir no existe.