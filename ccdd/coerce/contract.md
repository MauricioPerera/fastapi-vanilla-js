---
task: coerce-value-to-schema-types
intent: Coercionar un valor a los tipos declarados por el esquema
target: ../../lib/validation.js
language: javascript
signature: "function coerce(value, schema)"
budget: { cyclomatic_max: 10, nesting_max: 3, params_max: 3, lines_max: 35 }
deps_allowed: []
forbids: [eval, exec]
tests: test_coerce.js
test_command: "node --test ../ccdd/coerce/test_coerce.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Coercionar un valor a los tipos declarados por el esquema, de forma recursiva y sin mutar la entrada, dejando pasar sin cambios lo no coercible para que la validación posterior lo marque.

## Interface
- `coerce(value: any, schema: { type: string, ... }) -> any`
- `value`: valor entrante (escalar, objeto, array, `null`/`undefined`).
- `schema`: esquema declarativo con `type` y, opcionalmente, `properties` (object) o `items` (array).
- Devuelve el valor coercionado al tipo declarado cuando la coerción aplica, o el valor original si no es coercible.

## Invariants
- `null` y `undefined` se devuelven sin cambios.
- No muta la entrada: los objetos se copian (`{ ...value }`) antes de recursar.
- Objetos: coerciona solo las propiedades declaradas en `schema.properties`; conserva las extras intactas.
- Arrays: coerciona cada elemento contra `schema.items`.
- Lo no coercible (p. ej. `'abc'` a `number`) se devuelve sin cambios para que `validate` lo rechace.
- Schema objeto con `value` no-objeto: se devuelve sin cambios (preserva el tipo para que `validate` falle).

## Examples
- `coerce('30', { type: 'number' })` -> `30`
- `coerce('5.5', { type: 'integer' })` -> `'5.5'` (no entero, sin cambios)
- `coerce('1', { type: 'boolean' })` -> `true`
- `coerce({ age: '30', x: 1 }, { type: 'object', properties: { age: { type: 'integer' } } })` -> `{ age: 30, x: 1 }`
- `coerce(['1', '2'], { type: 'array', items: { type: 'integer' } })` -> `[1, 2]`

## Do / Don't
- DO: copiar el objeto antes de mutar (`{ ...value }`) para no alterar la entrada.
- DO: devolver el valor sin cambios cuando la coerción no aplica o el tipo no encaja.
- DON'T: lanzar excepciones por entradas no coercibles.
- DON'T: mutar `value` ni `schema`.
- DON'T: descartar propiedades extra del objeto (eso es tarea de `serialize`).

## Tests
Property-tests congelados en `ccdd/coerce/test_coerce.js` (oráculo independiente, no importa el target):
- `number`/`integer` desde string; `boolean` incluye `1`/`0` numéricos.
- Guard: schema objeto con `value` no-objeto se devuelve igual.
- `string` desde number/boolean; objeto conserva extras; array coerciona items; nullish passthrough; no mutación de la entrada.

## Constraints
- Budget: cyclomatic ≤ 10, nesting ≤ 3, params ≤ 3, lines ≤ 35.
- `deps_allowed: []` — sin dependencias externas; `forbids: [eval, exec]`.
- Recursión solo por `properties` (object) e `items` (array).
- PARAR y reportar si el gate excede el budget o si una entrada no coercible lanza en lugar de devolverse sin cambios.
