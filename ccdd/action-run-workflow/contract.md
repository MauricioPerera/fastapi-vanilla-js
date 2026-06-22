---
task: action-run-workflow
intent: Ejecutar secuencialmente los steps de un workflow
target: ../../lib/actions.js
language: javascript
signature: "async function runWorkflow(workflow, event, cwd)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 3, lines_max: 18 }
deps_allowed: []
forbids: [eval]
tests: test_run_workflow.js
test_command: "node --test ../ccdd/action-run-workflow/test_run_workflow.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Ejecutar los steps de un workflow secuencialmente (deteniéndose al primer fallo) y devolver el run record sin persistirlo.

## Interface
- `runWorkflow(workflow, event, cwd) -> Promise<run>`
- `run = { id, workflow, event, status: 'success'|'failure', startedAt, finishedAt, steps: result[] }`.
- Lanza `ActionError('invalid_workflow')` (vía `validateWorkflow`) si el workflow es inválido.

## Invariants
- `run.id` es un UUID único por llamada.
- `status === 'failure'` si algún step falla; en ese caso los steps posteriores NO se ejecutan.
- `run.steps` contiene solo los steps ejecutados (hasta el primer fallo inclusive).
- `startedAt` y `finishedAt` son ISO strings; `startedAt <= finishedAt`.
- Cada step del run tiene `startedAt` y `finishedAt`.

## Examples
- Workflow con 2 steps exitosos -> `status: 'success'`, `steps.length === 2`.
- Workflow con 3 steps donde el 2.º falla -> `status: 'failure'`, `steps.length === 2` (el 3.º no corre).
- Workflow inválido -> lanza `invalid_workflow`.

## Do / Don't
- DO: parar al primer step fallido.
- DO: generar un `id` único por run.
- DON'T: persistir el run (eso es responsabilidad del dispatcher).
- DON'T: continuar ejecutando steps tras un fallo.

## Tests
Property-tests congelados en `ccdd/action-run-workflow/test_run_workflow.js` (oráculo independiente: scripts node temporales, verifica forma del run y parada):
- 2 steps exitosos -> `status: 'success'`, 2 steps con timestamps.
- Fallo en el 2.º step de 3 -> `status: 'failure'`, solo 2 steps (el 3.º no ejecutado).
- Run tiene `id`, `workflow`, `event` y `startedAt <= finishedAt`.

## Constraints
- Budget: cyclomatic ≤ 6, nesting ≤ 2, params ≤ 3, lines ≤ 18.
- `deps_allowed: []`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si ejecuta steps tras un fallo.