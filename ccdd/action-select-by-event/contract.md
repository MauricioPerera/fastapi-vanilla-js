---
task: action-select-by-event
intent: Filtrar workflows por evento de trigger
target: ../../lib/actions.js
language: javascript
signature: "function selectWorkflowsByEvent(workflows, event)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 2, lines_max: 8 }
deps_allowed: []
forbids: [eval]
tests: test_select_by_event.js
test_command: "node --test ../ccdd/action-select-by-event/test_select_by_event.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Filtrar una lista de workflows devolviendo solo aquellos cuyo `trigger` coincide con `event`.

## Interface
- `selectWorkflowsByEvent(workflows, event) -> object[]`
- Devuelve `[]` si `workflows` no es array o `event` no es string no vacío.

## Invariants
- El resultado conserva el orden original de `workflows`.
- La comparación de `trigger` es estricta (`===`).
- Entradas `null`/falsas de `workflows` se excluyen (no tienen `trigger`).

## Examples
- `selectWorkflowsByEvent([{trigger:'push'},{trigger:'issue_opened'}], 'push')` -> `[{trigger:'push'}]`.
- `selectWorkflowsByEvent([], 'push')` -> `[]`.
- `selectWorkflowsByEvent('x', 'push')` -> `[]` (no es array).
- `selectWorkflowsByEvent([{trigger:'push'}], '')` -> `[]` (event vacío).

## Do / Don't
- DO: devolver `[]` ante inputs inválidos en lugar de lanzar.
- DON'T: mutar el array de entrada.

## Tests
Property-tests congelados en `ccdd/action-select-by-event/test_select_by_event.js` (oráculo independiente):
- Filtra solo los de trigger coincidente, conservando orden.
- Entradas null se excluyen.
- Inputs inválidos devuelven `[]`.

## Constraints
- Budget: cyclomatic ≤ 5, nesting ≤ 2, params ≤ 2, lines ≤ 8.
- `deps_allowed: []` (función pura); `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si lanza ante inputs inválidos.