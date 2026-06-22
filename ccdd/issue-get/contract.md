---
task: issue-get
intent: Obtener un issue por su numero
target: ../../lib/issues.js
language: javascript
signature: "async function getIssue(repoName, issuesDir, number)"
budget: { cyclomatic_max: 4, nesting_max: 1, params_max: 3, lines_max: 6 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_issue_get.js
test_command: "node --test ../ccdd/issue-get/test_issue_get.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Obtener un issue de un repo por su número, devolviendo la referencia al issue del store.

## Interface
- `getIssue(repoName, issuesDir, number) -> Promise<issue>`
- Lanza `IssueError('not_found')` si no existe un issue con ese número.
- Lanza `RepoError('invalid_name')` si el nombre de repo es inválido.

## Invariants
- Repo sin store => lanza `not_found` para cualquier número.
- El número debe coincidir con `issue.number`.

## Examples
- `getIssue('r', <tmp con issue #1>, 1)` -> `{ number: 1, title: ..., ... }`.
- `getIssue('r', <tmp>, 99)` -> lanza `not_found`.
- `getIssue('r', <tmp vacio>, 1)` -> lanza `not_found`.

## Do / Don't
- DO: delegar la búsqueda a `findIssue`.
- DON'T: crear store si no existe.

## Tests
Property-tests congelados en `ccdd/issue-get/test_issue_get.js` (oráculo independiente: siembra via `createIssue`):
- Issue existente devuelto con sus campos.
- Número inexistente lanza `not_found`.
- Repo sin store lanza `not_found`.

## Constraints
- Budget: cyclomatic ≤ 4, nesting ≤ 1, params ≤ 3, lines ≤ 6.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si getIssue devuelve un issue con número distinto al pedido.