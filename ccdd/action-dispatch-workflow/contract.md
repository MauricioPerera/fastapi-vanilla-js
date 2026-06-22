---
task: action-dispatch-workflow
intent: Disparar un workflow por nombre
target: ../../lib/actions.js
language: javascript
signature: "async function dispatchWorkflow(repoName, wfName, event, ctx)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 4, lines_max: 12 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_dispatch_workflow.js
test_command: "node --test ../ccdd/action-dispatch-workflow/test_dispatch_workflow.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Cargar un workflow por nombre, ejecutarlo con `event` y `ctx.cwd`, y persistir el run en `ctx.runsDir`; devuelve el run.

## Interface
- `dispatchWorkflow(repoName, wfName, event, ctx) -> Promise<run>`
- `ctx = { workflowsDir, runsDir, cwd }`.
- Lanza `ActionError('not_found')` si el workflow no existe.
- Lanza `RepoError('invalid_name')` si `repoName` o `wfName` son inválidos.

## Invariants
- El workflow se lee de `<workflowsDir>/<repo>/<wfName>.json`.
- El run se persiste atómicamente en `<runsDir>/<repo>/<run.id>.json`.
- El run devuelto es el mismo que el persistido.
- Si el workflow no existe, lanza antes de ejecutar nada.

## Examples
- `dispatchWorkflow('r', 'build', 'manual', ctx)` con `build.json` presente -> ejecuta y persiste un run, devuelve el run.
- `dispatchWorkflow('r', 'missing', 'manual', ctx)` -> lanza `not_found`.
- `dispatchWorkflow('../bad', 'w', 'manual', ctx)` -> lanza `invalid_name`.

## Do / Don't
- DO: persistir el run tras ejecutarlo.
- DO: lanzar `not_found` si el workflow no existe.
- DON'T: ejecutar steps si el workflow falta.
- DON'T: mutar el archivo de workflow.

## Tests
Property-tests congelados en `ccdd/action-dispatch-workflow/test_dispatch_workflow.js` (oráculo independiente: escribe el workflow con fs directo y lee el run persistido con fs directo):
- Dispatch de un workflow existente ejecuta y persiste un run en `<runsDir>/<repo>/<run.id>.json`.
- Workflow inexistente lanza `not_found`.
- `repoName`/`wfName` con path traversal lanza `invalid_name`.

## Constraints
- Budget: cyclomatic ≤ 5, nesting ≤ 2, params ≤ 4, lines ≤ 12.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si ejecuta steps de un workflow inexistente.