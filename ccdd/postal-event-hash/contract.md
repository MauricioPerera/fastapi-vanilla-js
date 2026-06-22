---
task: postal-event-hash
intent: Calcular el hash SHA-256 hex del evento canonico
target: ../../lib/postal.js
language: javascript
signature: "async function eventHash(ev)"
budget: { cyclomatic_max: 3, nesting_max: 1, params_max: 1, lines_max: 6 }
deps_allowed: []
forbids: [eval]
tests: test_event_hash.js
test_command: "node --test ../ccdd/postal-event-hash/test_event_hash.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Devolver el hash SHA-256 (hex 64) del evento serializado canonicamente; es el valor que el siguiente evento del mismo autor referencia como prev.

## Interface
- eventHash(ev: object) -> Promise<string(hex 64)>

## Invariants
- Determinista: el mismo evento produce el mismo hash.
- 64 caracteres hex.
- Independiente del orden de claves del evento.

## Examples
- eventHash({a:1,b:2}) === eventHash({b:2,a:1}) -> true.
- eventHash({a:1}) !== eventHash({a:2}) -> true.

## Do / Don't
- DO: hashear canonical(ev) en UTF-8.
- DON'T: incluir campos transitorios fuera del evento.

## Tests
Property-tests: 64 hex, determinismo, sensibilidad a cambios, independencia de orden de claves.

## Constraints
- Budget cyclomatic <= 3, nesting <= 1.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.