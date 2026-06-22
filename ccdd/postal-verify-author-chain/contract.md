---
task: postal-verify-author-chain
intent: Verificar la cadena de un solo autor
target: ../../lib/postal.js
language: javascript
signature: "async function verifyAuthorChain(from, list)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 2, lines_max: 16 }
deps_allowed: []
forbids: [eval]
tests: test_verify_author_chain.js
test_command: "node --test ../ccdd/postal-verify-author-chain/test_verify_author_chain.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Verificar que la cadena de un autor es contigua desde seq 0 y prev = hash del evento previo; devolver los fallos.

## Interface
- verifyAuthorChain(from, list: event[]) -> Promise<{ from, seq, reasons[] }[]>

## Invariants
- Cadena contigua desde 0 con prev correcto -> [].
- Hueco de seq -> chain-gap.
- prev incorrecto -> chain-prev-mismatch.
- No muta la lista (ordena una copia).

## Examples
- verifyAuthorChain("a", [{seq:0,prev:null,...}]) -> [].
- verifyAuthorChain("a", [{seq:0,prev:null},{seq:2,...}]) -> un fallo chain-gap.

## Do / Don't
- DO: ordenar por seq antes de verificar.
- DON'T: asumir que la lista viene ordenada.

## Tests
Property-tests: cadena valida vacia; gap detectado; prev mismatch detectado; no muta input.

## Constraints
- Budget cyclomatic <= 6, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.