---
task: postal-make-event-id
intent: Construir el id determinista del evento
target: ../../lib/postal.js
language: javascript
signature: "function makeEventId(createdAt, from, rnd)"
budget: { cyclomatic_max: 2, nesting_max: 1, params_max: 3, lines_max: 4 }
deps_allowed: []
forbids: [eval]
tests: test_make_event_id.js
test_command: "node --test ../ccdd/postal-make-event-id/test_make_event_id.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Devolver el id determinista del evento: <created_at con :/. reemplazados por ->_<from>_<rnd>, verificable sin abrir el archivo.

## Interface
- makeEventId(createdAt: string, from: string, rnd: string) -> string

## Invariants
- Reemplaza ":" y "." de createdAt por "-".
- Formato: createdAt_from_rnd.
- Determinista para los mismos argumentos.

## Examples
- makeEventId("2026-01-02T03:04:05.678Z","alice","r1") -> "2026-01-02T03-04-05-678Z_alice_r1".
- makeEventId("a.b:c","x","y") -> "a-b-c_x_y".

## Do / Don't
- DO: reemplazar ambos separadores : y .
- DON'T: introducir aleatoriedad no pasada como argumento.

## Tests
Property-tests: formato, reemplazo de : y ., determinismo.

## Constraints
- Budget cyclomatic <= 2, nesting <= 1.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.