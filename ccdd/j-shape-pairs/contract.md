---
task: j-shape-pairs
intent: Listar los pares de tools MCP con arbol de tipos identico, eximiendo los declarados mutuamente como x-variant-of
target: ../../ccdd/aacs-lite.js
language: javascript
signature: "function jShapePairs(tools)"
budget: { cyclomatic_max: 6, nesting_max: 3, params_max: 1, lines_max: 14 }
deps_allowed: []
forbids: [eval]
tests: test_j_shape_pairs.js
test_command: "node --test ../ccdd/j-shape-pairs/test_j_shape_pairs.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Detectar colisiones de forma (J_shape) entre tools MCP: dos tools cuyo arbol de tipos de inputSchema es estructuralmente identico (name-blind, fingerprint Jaccard > 0.95) forman un par "a~b". La exencion AACS §3.5 `x-variant-of` (mutua) exime del conteo a las familias reales indistinguibles a proposito.

## Interface
- `jShapePairs(tools: Array<{ id, entity, inputSchema }>) -> string[]`
- Cada elemento del array retornado es `"a~b"` donde a.id < lexico no garantizado; es la concatenacion `${tools[i].id}~${tools[j].id}` con i<j (orden de aparicion en el array de entrada).
- `inputSchema['x-variant-of']` puede ser `string` o `string[]` (ids de tools hermanas).
- Un par (a,b) se exime SOLO si la declaracion es MUTUA: `b.id` esta en variantOf(a) Y `a.id` esta en variantOf(b).

## Invariants
- El par se reporta cuando J_shape(fp(a), fp(b)) > 0.95 y NO hay exencion mutua.
- Declaracion unilateral (solo a->b, o a->b pero b->otro) NO exime: el par sigue contando.
- Declaracion mutua pero ids cruzados incorrectos (a->b, b->c) NO exime.
- Tools con forma distinta nunca forman par.
- Sin x-variant-of en ninguna, el conteo es identico al J_shape puro (back-compat con la superficie REST 1:1).

## Examples
- `jShapePairs([{id:'x',entity:'e',inputSchema:S},{id:'y',entity:'e',inputSchema:S}])` -> `['x~y']` con S shapes identicos y sin x-variant-of.
- Mismo par con `S.x-variant-of` mutuo (`x`->'y', `y`->'x') -> `[]` (eximido).
- Mismo par con x-variant-of unilateral (`x`->'y' nada mas) -> `['x~y']` (sigue contando).
- Tres tools identicos a,b,c con x-variant-of mutuo en array (`[otros dos]` cada uno) -> `[]`.

## Do / Don't
- DO: iterar i<j sin duplicar el par.
- DO: aceptar x-variant-of como string o array.
- DON'T: eximir un par cuya declaracion no sea mutua y cruzada (a<->b exactos).
- DON'T: depender de los nombres de las propiedades para el fingerprint (name-blind).

## Tests
Property-tests congelados en `ccdd/j-shape-pairs/test_j_shape_pairs.js` (oraculo independiente: construye tools sinteticas con schema conocido y verifica el conjunto de pares):
- Par identico sin declarar -> se cuenta.
- Par identico con x-variant-of mutuo -> se exime (no se cuenta).
- Par identico con x-variant-of unilateral -> sigue contando.
- Par identico con x-variant-of mutuo pero ids cruzados incorrectos -> sigue contando.
- Tools de forma distinta -> no forman par.
- Triangulo de 3 tools identicas con x-variant-of mutuo en array -> ningun par.
- Integracion via `gate()`: una sola colision sin eximir -> finding j-shape ERROR; con exencion mutua -> sin finding j-shape.

## Constraints
- Budget: cyclomatic <= 6, nesting <= 3, params <= 1, lines <= 14.
- `deps_allowed: []` (aacs-lite es zero-dep; jShapePairs usa solo helpers del mismo modulo).
- `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si un par mutuamente eximido aparece en el resultado, o si un par sin eximir deja de aparecer.