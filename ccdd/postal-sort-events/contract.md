---
task: postal-sort-events
intent: Ordenar eventos por created_at con desempate determinista por seq
target: ../../lib/postal.js
language: javascript
signature: "function sortEvents(events)"
budget: { cyclomatic_max: 4, nesting_max: 2, params_max: 1, lines_max: 8 }
deps_allowed: []
forbids: [eval]
tests: test_sort_events.js
test_command: "node --test ../ccdd/postal-sort-events/test_sort_events.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Devolver una copia ordenada cronologicamente por `created_at`; a igual `created_at`,
desempatar por `seq` ascendentemente para que el orden sea determinista (mismo ms).

## Interface
- sortEvents(events: event[]) -> event[]

## Invariants
- No muta el array de entrada (opera sobre una copia con .slice()).
- Orden primario: created_at ascendente (comparacion lexicografica de strings ISO).
- Desempate: si created_at iguales, return a.seq - b.seq.
- Estable respecto al input: dos llamadas con el mismo array devuelven el mismo orden.
- Array vacio -> [].

## Examples
- sortEvents([]) -> [].
- sortEvents([{created_at:'2026-01-02',seq:1},{created_at:'2026-01-01',seq:0}]) ->
  orden [seq 0, seq 1].
- sortEvents([{created_at:T,seq:2},{created_at:T,seq:0},{created_at:T,seq:1}]) ->
  orden [seq 0, seq 1, seq 2] (mismo created_at, desempate por seq).

## Do / Don't
- DO: usar .slice() antes de sort (no mutar input).
- DO: desempatar por seq cuando created_at coincide.
- DON'T: devolver return 0 en empate (orden no determinista).

## Tests
Property-tests: vacio; ordena por created_at; desempata por seq a igual created_at
(determinismo); no muta el input.

## Constraints
- Budget cyclomatic <= 4, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.