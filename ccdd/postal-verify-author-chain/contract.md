---
task: postal-verify-author-chain
intent: Verificar la cadena de un solo autor con corte de propagacion
target: ../../lib/postal.js
language: javascript
signature: "async function verifyAuthorChain(from, list)"
budget: { cyclomatic_max: 7, nesting_max: 2, params_max: 2, lines_max: 16 }
deps_allowed: []
forbids: [eval]
tests: test_verify_author_chain.js
test_command: "node --test ../ccdd/postal-verify-author-chain/test_verify_author_chain.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Verificar que la cadena de un autor es contigua desde seq 0 y prev = hash del evento
previo; devolver los fallos. Una vez rota la cadena (gap o prev-mismatch), TODO evento
posterior de ese autor se rechaza con reason 'chain-broken' (no se reanuda).

## Interface
- verifyAuthorChain(from, list: event[]) -> Promise<{ from, seq, reasons[] }[]>

## Invariants
- Cadena contigua desde 0 con prev correcto -> [].
- Hueco de seq -> chain-gap (en el evento donde se detecta).
- prev incorrecto -> chain-prev-mismatch (en el evento donde se detecta).
- Tras el primer fallo (chain-gap o chain-prev-mismatch), broken=true: todo evento
  posterior del mismo autor se reporta con reasons ['chain-broken'] y NO avanza
  expected/prevHash (la cadena queda cortada; no se reanuda).
- El evento que rompe conserva sus reasons originales (chain-gap / chain-prev-mismatch),
  NO se etiqueta chain-broken.
- No muta la lista (ordena una copia).

## Examples
- verifyAuthorChain("a", [{seq:0,prev:null,...}]) -> [].
- verifyAuthorChain("a", [{seq:0,prev:null},{seq:2,...}]) -> un fallo chain-gap en seq 2.
- verifyAuthorChain("a", [0,1,2,3] con el 1 borrado) -> fallo en seq 2 (chain-gap +
  chain-prev-mismatch) Y fallo chain-broken en seq 3 (no solo el inmediato).
- verifyAuthorChain("a", [0,1,2,3] con el 1 editado/prev roto) -> fallo en seq 1
  (chain-prev-mismatch) Y chain-broken en 2 y 3.

## Do / Don't
- DO: ordenar por seq antes de verificar.
- DO: cortar la cadena al primer fallo (chain-broken a los posteriores).
- DON'T: asumir que la lista viene ordenada.
- DON'T: reanudar la validacion ni actualizar prevHash/expected tras un fallo.

## Tests
Property-tests: cadena valida vacia; gap detectado; prev mismatch detectado; no muta
input; corte de cadena — borrar el evento medio de [0,1,2,3] -> sucesor Y todos los
posteriores se rechazan (chain-broken), no solo el inmediato; editar un evento
intermedio -> idem (chain-broken en los posteriores).

## Constraints
- Budget cyclomatic <= 7 (el flag chain-broken suma 1 rama frente al 6 previo;
  ajuste honesto por fix de integridad hash-chain), nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.