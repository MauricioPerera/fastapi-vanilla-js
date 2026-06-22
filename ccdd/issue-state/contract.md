---
task: issue-state
intent: Cambiar el estado de un issue
target: ../../lib/issues.js
language: javascript
signature: "async function setIssueState(repoName, issuesDir, number, state)"
budget: { cyclomatic_max: 4, nesting_max: 1, params_max: 4, lines_max: 10 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_issue_state.js
test_command: "node --test ../ccdd/issue-state/test_issue_state.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Cambiar el estado de un issue a `open` o `closed` (cerrar/reabrir), persistiendo y devolviendo el issue.

## Interface
- `setIssueState(repoName, issuesDir, number, state) -> Promise<issue>`
- `state` debe ser `'open'` o `'closed'`.
- Lanza `IssueError('invalid_state')` si `state` no es válido (valida antes de leer el store).
- Lanza `IssueError('not_found')` si el issue no existe.
- Actualiza `updatedAt`.

## Invariants
- El estado se valida antes de buscar el issue.
- `number` y `createdAt` no cambian.
- El cambio persiste atómicamente.

## Examples
- `setIssueState('r', <tmp con #1 open>, 1, 'closed')` => `issue.state === 'closed'`.
- `setIssueState('r', <tmp con #1 closed>, 1, 'open')` => `issue.state === 'open'` (reabrir).
- `setIssueState('r', <tmp>, 1, 'bogus')` => lanza `invalid_state`.
- `setIssueState('r', <tmp>, 99, 'closed')` => lanza `not_found`.

## Do / Don't
- DO: validar `state` antes de tocar el store.
- DON'T: aceptar estados fuera de `{open, closed}`.
- DON'T: cambiar `number` ni `createdAt`.

## Tests
Property-tests congelados en `ccdd/issue-state/test_issue_state.js` (oráculo independiente: siembra via `createIssue`):
- Cerrar un issue open => `state === 'closed'`.
- Reabrir un issue closed => `state === 'open'`.
- Estado inválido lanza `invalid_state`.
- Issue inexistente lanza `not_found`.

## Constraints
- Budget: cyclomatic ≤ 4, nesting ≤ 1, params ≤ 4, lines ≤ 10.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si setIssueState acepta un estado distinto de open/closed.