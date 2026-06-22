---
task: flat-array-coercer
intent: Coercionar/validar un valor como array plano opcionalmente coerciendo sus elementos
target: ../../lib/fastapi.js
language: javascript
signature: "function coerceArray(value, key, rules)"
budget: { cyclomatic_max: 8, nesting_max: 3, params_max: 3, lines_max: 20 }
deps_allowed: []
forbids: [eval, exec]
tests: test_flat_array_coercer.js
test_command: "node --test ../ccdd/flat-array-coercer/test_flat_array_coercer.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Coercionar/validar un valor como array para el validador plano de query/body (`FLAT_COERCERS`), devolviendo `{ value }` si es array (con coerción opcional de elementos vía `itemsType`) o `{ error }` si no lo es.

## Interface
- `coerceArray(value: any, key: string, rules?: { itemsType?: string }) -> { value: any[] } | { error: string }`
- `value`: valor entrante cualquiera.
- `key`: nombre del campo, sólo para el mensaje de error.
- `rules`: esquema plano del campo; se usa `rules.itemsType` (opcional) para coercer cada elemento con el coercer plano del mismo nombre.
- Devuelve `{ value }` con el array (elementos coercionados si `itemsType` aplica) o `{ error }` con mensaje.

## Invariants
- Si `value` no es array -> `{ error }` (no lanza).
- Sin `itemsType` -> devuelve `{ value }` con el array tal cual (sin copiar; el caller no muta).
- Con `itemsType` resuelto a un coercer plano conocido -> coerciona cada elemento; si alguno da `{ error }` -> devuelve `{ error }` global.
- Con `itemsType` que NO corresponde a un coercer plano conocido -> devuelve `{ value }` sin coercionar (mejor esfuerzo, no falla).
- No muta el array de entrada cuando coerciona (construye un array nuevo).
- No lanza; todo error se devuelve como `{ error }`.

## Examples
- `coerceArray([1, 2], 'x')` -> `{ value: [1, 2] }`
- `coerceArray('nope', 'x')` -> `{ error: "El campo 'x' debe ser un array." }`
- `coerceArray(['1', '2'], 'x', { itemsType: 'number' })` -> `{ value: [1, 2] }`
- `coerceArray([1, 'b'], 'x', { itemsType: 'number' })` -> `{ error: ... }` (elemento 'b' no coercible a number)
- `coerceArray([true, false], 'x', { itemsType: 'boolean' })` -> `{ value: [true, false] }`

## Do / Don't
- DO: devolver `{ error }` cuando el valor no es array.
- DO: construir un array nuevo al coercionar elementos (no mutar la entrada).
- DO: ignorar `itemsType` desconocido de forma graceful (devolver `{ value }`).
- DON'T: lanzar excepciones.
- DON'T: mutar el array entrante.
- DON'T: coercionar elementos si `itemsType` no está declarado.

## Tests
Property-tests congelados en `ccdd/flat-array-coercer/test_flat_array_coercer.js` (oráculo que importa `coerceArray` desde `lib/fastapi.js`):
- Array plano pasa tal cual sin `itemsType`.
- No-array devuelve `{ error }` (string, number, null, objeto).
- `itemsType: 'number'` coerciona strings numéricos.
- `itemsType: 'boolean'` coerciona `'true'`/`'false'` y admite booleanos ya correctos.
- Elemento no coercible con `itemsType` declarado -> `{ error }`.
- `itemsType` desconocido -> `{ value }` sin coercionar (graceful).
- No muta el array de entrada.

## Constraints
- Budget: cyclomatic ≤ 8, nesting ≤ 3, params ≤ 3, lines ≤ 20.
- `deps_allowed: []` — sin dependencias externas; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget, si un no-array lanza en lugar de devolver `{ error }`, o si la coerción de elementos muta el array de entrada.