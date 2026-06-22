---
task: action-list-workflows
intent: Listar los workflows de un repo
target: ../../lib/actions.js
language: javascript
signature: "async function listWorkflows(repoName, workflowsDir)"
budget: { cyclomatic_max: 7, nesting_max: 2, params_max: 2, lines_max: 18 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_list_workflows.js
test_command: "node --test ../ccdd/action-list-workflows/test_list_workflows.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Listar los workflows persistidos de un repo, devolviendo los JSON parseados ordenados por nombre.

## Interface
- `listWorkflows(repoName, workflowsDir) -> Promise<object[]>`
- Sanitiza `repoName` con `sanitizeRepoName` (lanza `RepoError('invalid_name')` si es inválido).
- Devuelve `[]` si el directorio del repo no existe.

## Invariants
- Solo se leen archivos `.json` (se ignoran otros).
- Archivos corruptos (JSON inválido) se ignoran sin lanzar.
- El resultado está ordenado por `name` ascendente (localeCompare).

## Examples
- Repo sin workflows -> `[]`.
- Repo con `a.json` y `b.json` -> array de 2 workflows ordenados `[a, b]`.
- `listWorkflows('../bad', <dir>)` -> lanza `invalid_name`.

## Do / Don't
- DO: ignorar archivos no-JSON y JSON corruptos.
- DO: ordenar por nombre.
- DON'T: lanzar si el directorio no existe (devolver `[]`).

## Tests
Property-tests congelados en `ccdd/action-list-workflows/test_list_workflows.js` (oráculo independiente: escribe los JSON con fs directo y verifica el listado):
- Repo sin dir -> `[]`.
- Devuelve workflows ordenados por nombre.
- Ignora archivos no-JSON.
- Path traversal lanza `invalid_name`.

## Constraints
- Budget: cyclomatic ≤ 7, nesting ≤ 2, params ≤ 2, lines ≤ 18.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si lanza en lugar de devolver `[]` cuando el dir no existe.