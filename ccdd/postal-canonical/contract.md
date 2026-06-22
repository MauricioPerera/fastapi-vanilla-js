---
task: postal-canonical
intent: Serializar un valor a JSON determinista con claves ordenadas
target: ../../lib/postal.js
language: javascript
signature: "function canonical(value)"
budget: { cyclomatic_max: 4, nesting_max: 2, params_max: 1, lines_max: 8 }
deps_allowed: []
forbids: [eval]
tests: test_canonical.js
test_command: "node --test ../ccdd/postal-canonical/test_canonical.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Devolver una serializacion JSON determinista (claves ordenadas recursivamente) para hashing/firma estable entre autores.

## Interface
- canonical(value: any) -> string

## Invariants
- Objetos: claves ordenadas lexicograficamente, recursivo.
- Arrays: elementos canonizados en orden.
- Dos valores semanticamente iguales producen bytes identicos sin importar el orden de claves.
- null/number/string/boolean usan JSON.stringify nativo.

## Examples
- canonical({b:2,a:1}) -> '{"a":1,"b":2}'.
- canonical({a:1}) === canonical({a:1}) -> true.

## Do / Don't
- DO: ordenar claves con Object.keys().sort().
- DON'T: depender del orden de insercion del objeto.

## Tests
Property-tests congelados en ccdd/postal-canonical/test_canonical.js: claves ordenadas, independencia de orden, arrays anidados, escalares.

## Constraints
- Budget cyclomatic <= 4, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.