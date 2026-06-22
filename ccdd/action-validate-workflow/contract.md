---
task: action-validate-workflow
intent: Validar una definicion de workflow cruda
target: ../../lib/actions.js
language: javascript
signature: "function validateWorkflow(raw)"
budget: { cyclomatic_max: 8, nesting_max: 2, params_max: 1, lines_max: 15 }
deps_allowed: []
forbids: [eval]
tests: test_validate_workflow.js
test_command: "node --test ../ccdd/action-validate-workflow/test_validate_workflow.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Validar y normalizar una definición de workflow cruda, devolviendo `{ name, trigger, steps }` con steps normalizados, o lanzando `ActionError('invalid_workflow')` si algo es inválido.

## Interface
- `validateWorkflow(raw: object) -> { name: string, trigger: string, steps: {name,command}[] }`
- Lanza `ActionError('invalid_workflow')` si `raw` no es objeto, `name` vacío, `trigger` inválido, `steps` no es array no vacío, o algún step es inválido.

## Invariants
- `trigger` ∈ `['push','issue_opened','manual']`.
- `steps` siempre tiene ≥1 elemento tras normalizar.
- Un step string `"cmd"` se normaliza a `{ name: 'cmd', command: 'cmd' }`.
- Un step objeto `{ command }` usa `command` como `name` si `name` falta.
- `name` se hace trim.

## Examples
- `validateWorkflow({ name: 'build', trigger: 'push', steps: ['echo hi'] })` -> `{ name: 'build', trigger: 'push', steps: [{ name: 'echo hi', command: 'echo hi' }] }`.
- `validateWorkflow({ name: 'x', trigger: 'bad', steps: ['c'] })` -> lanza `invalid_workflow`.
- `validateWorkflow({ name: 'x', trigger: 'manual', steps: [] })` -> lanza `invalid_workflow`.
- `validateWorkflow({ name: 'x', trigger: 'manual', steps: [{ command: 'c' }] })` -> `steps[0].command === 'c'`.

## Do / Don't
- DO: normalizar steps string a `{name,command}`.
- DO: rechazar triggers fuera del set válido.
- DON'T: aceptar `steps` vacío o no-array.
- DON'T: mutar el objeto de entrada.

## Tests
Property-tests congelados en `ccdd/action-validate-workflow/test_validate_workflow.js` (oráculo independiente: aplica las reglas directamente, sin importar internos del target):
- Workflow válido se normaliza con steps string -> `{name,command}`.
- Step objeto sin `name` usa `command` como nombre.
- `name` vacío, trigger inválido y steps vacío lanzan `invalid_workflow`.
- Step con `command` no-string lanza `invalid_workflow`.

## Constraints
- Budget: cyclomatic ≤ 8, nesting ≤ 2, params ≤ 1, lines ≤ 15.
- `deps_allowed: []` (función pura); `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si acepta un trigger fuera del set válido.