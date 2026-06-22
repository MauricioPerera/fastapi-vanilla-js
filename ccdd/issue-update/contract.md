---
task: issue-update
intent: Actualizar campos de un issue existente
target: ../../lib/issues.js
language: javascript
signature: "async function updateIssue(repoName, issuesDir, number, patch)"
budget: { cyclomatic_max: 10, nesting_max: 2, params_max: 4, lines_max: 20 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_issue_update.js
test_command: "node --test ../ccdd/issue-update/test_issue_update.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Actualizar en parte el título, body o labels de un issue existente, persistiendo y devolviendo el issue modificado.

## Interface
- `updateIssue(repoName, issuesDir, number, patch: { title?, body?, labels? }) -> Promise<issue>`
- Solo los campos presentes en `patch` se modifican.
- Lanza `IssueError('not_found')` si el issue no existe.
- Lanza `IssueError('invalid_body')` si `patch` no es objeto, o si `title` presente pero vacío/no-string.
- Lanza `IssueError('invalid_body')` si `labels` presente pero no es array.
- Actualiza `updatedAt` a la hora actual.

## Invariants
- `patch.title === undefined` => no toca el título.
- `patch.body === undefined` => no toca el body; si viene y no es string => `''`.
- `patch.labels === undefined` => no toca labels; si viene => se normaliza a strings no vacíos.
- El `number` y `createdAt` no cambian.
- El cambio persiste atómicamente.

## Examples
- `updateIssue('r', <tmp>, 1, { title: 'Nuevo' })` => `issue.title === 'Nuevo'`, body y labels intactos.
- `updateIssue('r', <tmp>, 1, { labels: ['bug','urgent'] })` => `issue.labels === ['bug','urgent']`.
- `updateIssue('r', <tmp>, 99, { title: 'x' })` => lanza `not_found`.
- `updateIssue('r', <tmp>, 1, { title: '' })` => lanza `invalid_body`.

## Do / Don't
- DO: modificar solo campos presentes.
- DO: rechazar `title` vacío si viene en el patch.
- DON'T: cambiar `number` ni `createdAt`.
- DON'T: aplicar el patch si el issue no existe (lanza antes de escribir).

## Tests
Property-tests congelados en `ccdd/issue-update/test_issue_update.js` (oráculo independiente: siembra via `createIssue`, verifica con fs directo):
- Actualizar solo título deja body/labels intactos y cambia `updatedAt`.
- Actualizar labels reemplaza el array.
- Issue inexistente lanza `not_found` y no crea store.
- `title` vacío en patch lanza `invalid_body`.

## Constraints
- Budget: cyclomatic ≤ 10, nesting ≤ 2, params ≤ 4, lines ≤ 20.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si updateIssue cambia el número del issue.