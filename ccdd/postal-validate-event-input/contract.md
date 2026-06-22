---
task: postal-validate-event-input
intent: Validar el input de appendEvent
target: ../../lib/postal.js
language: javascript
signature: "function validateEventInput(input)"
budget: { cyclomatic_max: 10, nesting_max: 2, params_max: 1, lines_max: 11 }
deps_allowed: []
forbids: [eval]
tests: test_validate_event_input.js
test_command: "node --test ../ccdd/postal-validate-event-input/test_validate_event_input.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Validar que el input de appendEvent tiene kind y agentId no vacios y payload objeto si llega; lanza PostalError invalid_input si no.

## Interface
- validateEventInput(input) -> input (la misma referencia)

## Invariants
- input debe ser objeto; si no, invalid_input.
- kind string no vacio; si no, invalid_input.
- agentId string no vacio; si no, invalid_input.
- payload undefined permitido; si llega y no es objeto, invalid_input.
- Devuelve el mismo objeto input sin mutar.

## Examples
- validateEventInput({kind:"x",agentId:"a"}) -> la misma ref.
- validateEventInput({agentId:"a"}) lanza invalid_input (sin kind).

## Do / Don't
- DO: lanzar con codigo invalid_input.
- DON'T: mutar el input.

## Tests
Property-tests: input valido devuelve misma ref; kind/agentId vacios lanzan; payload no-objeto lanza; payload undefined ok.

## Constraints
- Budget cyclomatic <= 10, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.