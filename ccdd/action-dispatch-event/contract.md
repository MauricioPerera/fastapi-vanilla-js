---
task: action-dispatch-event
intent: Disparar todos los workflows que matchean un evento
target: ../../lib/actions.js
language: javascript
signature: "async function dispatchEvent(repoName, event, ctx)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 3, lines_max: 14 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_dispatch_event.js
test_command: "node --test ../ccdd/action-dispatch-event/test_dispatch_event.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Listar los workflows de un repo, seleccionar los cuyo `trigger` coincide con `event`, ejecutarlos y persistir cada run; devuelve el array de runs.

## Interface
- `dispatchEvent(repoName, event, ctx) -> Promise<run[]>`
- `ctx = { workflowsDir, runsDir, cwd }`.
- Lanza `RepoError('invalid_name')` si `repoName` es inválido.

## Invariants
- Solo se ejecutan los workflows cuyo `trigger === event`.
- Cada run se persiste atómicamente en `<runsDir>/<repo>/<run.id>.json`.
- Sin workflows matcheados -> devuelve `[]` (sin lanzar).
- El array devuelto tiene un run por workflow matcheado, en el orden devuelto por `listWorkflows`.

## Examples
- Repo con 1 workflow `trigger: 'issue_opened'` y `dispatchEvent('r', 'issue_opened', ctx)` -> 1 run.
- Repo con workflows de triggers `push` y `issue_opened`, `dispatchEvent('r', 'push', ctx)` -> 1 run (solo el de push).
- Repo sin workflows matcheados -> `[]`.

## Do / Don't
- DO: persistir cada run.
- DO: devolver `[]` si nada matchea.
- DON'T: lanzar si no hay workflows.
- DON'T: ejecutar workflows cuyo trigger no coincide.

## Tests
Property-tests congelados en `ccdd/action-dispatch-event/test_dispatch_event.js` (oráculo independiente: escribe workflows con fs directo y cuenta runs persistidos con fs directo):
- 1 workflow `issue_opened` + 1 `push`; `dispatchEvent('issue_opened')` -> 1 run persistido, `dispatchEvent('push')` -> 1 run.
- Sin match -> `[]` y sin runs persistidos.
- Cada match genera un `run.id` distinto.

## Constraints
- Budget: cyclomatic ≤ 5, nesting ≤ 2, params ≤ 3, lines ≤ 14.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si ejecuta un workflow cuyo trigger no coincide con el evento.