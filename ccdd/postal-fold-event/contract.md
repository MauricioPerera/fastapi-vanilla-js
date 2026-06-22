---
task: postal-fold-event
intent: Plegar un evento sobre el estado devolviendo un nuevo estado
target: ../../lib/postal.js
language: javascript
signature: "function foldEvent(state, ev)"
budget: { cyclomatic_max: 4, nesting_max: 1, params_max: 2, lines_max: 8 }
deps_allowed: []
forbids: [eval]
tests: test_fold_event.js
test_command: "node --test ../ccdd/postal-fold-event/test_fold_event.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Plegar un evento sobre el estado: copia superficial, incrementa el contador del kind y aplica el body via applyBody; puro (no muta el estado de entrada).

## Interface
- foldEvent(state, ev) -> newState (copia)

## Invariants
- No muta el estado de entrada (devuelve una copia).
- Incrementa counts[ev.kind].
- Aplica el body via applyBody sobre la copia.
- Conserva issues/pulls/workflows/runs/messages/counts previos.

## Examples
- foldEvent({issues:{},pulls:{},workflows:{},runs:{},messages:[],counts:{}}, {kind:"agent.message",body:{text:"h"},from:"a"}) -> newState.messages.length === 1.
- foldEvent(..., {kind:"pr.created",body:{number:1,title:"t",head:"f",base:"m"}}) -> newState.pulls["1"] definido.
- el estado original no se muta.

## Do / Don't
- DO: copia superficial antes de mutar.
- DON'T: mutar el estado de entrada.

## Tests
Property-tests: pureza (no muta input); cuenta incrementada; issue.created crea issue; agent.message agrega.

## Constraints
- Budget cyclomatic <= 4, nesting <= 1.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.