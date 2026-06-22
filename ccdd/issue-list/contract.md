---
task: issue-list
intent: Listar los issues de un repo
target: ../../lib/issues.js
language: javascript
signature: "async function listIssues(repoName, issuesDir, stateFilter)"
budget: { cyclomatic_max: 8, nesting_max: 2, params_max: 3, lines_max: 12 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_issue_list.js
test_command: "node --test ../ccdd/issue-list/test_issue_list.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Listar los issues de un repo, opcionalmente filtrados por estado, devolviendo una copia del array.

## Interface
- `listIssues(repoName, issuesDir, stateFilter?) -> Promise<issue[]>`
- `stateFilter`: `'open'` | `'closed'` | `'all'` | undefined. Undefined o `'all'` => sin filtro.
- Lanza `IssueError('invalid_state')` si `stateFilter` es un valor distinto de los válidos (y no `'all'`/undefined).
- Lanza `RepoError('invalid_name')` si el nombre de repo es inválido.

## Invariants
- Sin store existente => devuelve `[]` (no crea archivo).
- El resultado es una copia (mutarla no afecta al store).
- El filtro por estado compara `issue.state === stateFilter`.
- Orden: el de inserción (no reordena).

## Examples
- `listIssues('r', <tmp>, undefined)` sobre store con 2 issues => array de 2.
- `listIssues('r', <tmp>, 'open')` con un open y un closed => array de 1 (el open).
- `listIssues('r', <tmp>, 'bogus')` => lanza `invalid_state`.
- `listIssues('r', <tmp vacio>, 'all')` => `[]`.

## Do / Don't
- DO: devolver una copia (`.slice()`).
- DO: rechazar estado inválido antes de filtrar.
- DON'T: crear el archivo de store si no existe.
- DON'T: mutar el array del store.

## Tests
Property-tests congelados en `ccdd/issue-list/test_issue_list.js` (oráculo independiente: siembra issues via `createIssue` y cuenta con fs directo):
- Sin store => `[]` y no crea archivo.
- Mezcla open/closed => filtro `'open'` devuelve solo los open.
- Estado inválido lanza `invalid_state`.

## Constraints
- Budget: cyclomatic ≤ 8, nesting ≤ 2, params ≤ 3, lines ≤ 12.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si el filtro devuelve issues de otro estado.