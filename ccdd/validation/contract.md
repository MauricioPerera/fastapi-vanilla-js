---
task: validate-value-against-schema
intent: Validar un valor contra un esquema declarativo recursivo
target: ../../lib/validation.js
language: javascript
signature: "function validate(value, schema, path)"
budget: { cyclomatic_max: 10, nesting_max: 3, params_max: 4, lines_max: 45 }
deps_allowed: []
forbids: [eval, exec]
tests: test_validate.js
test_command: "node --test ../ccdd/validation/test_validate.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Validar un valor contra un esquema declarativo recursivo, devolviendo un resultado agregado con los errores por path.

## Interface
- `validate(value: any, schema: { type: string, ... }, path: string = '') -> { valid: boolean, errors: Array<{ path: string, message: string }> }`
- `value`: valor a validar.
- `schema`: esquema con `type`; opcional `required`, constraints (`enum`, `minimum`, `maximum`, `minLength`, `maxLength`), `properties` (object) o `items` (array).
- `path`: ruta base para los mensajes de error (default `''`).
- Devuelve `{ valid, errors }`; `valid` es `true` si `errors` está vacío.

## Invariants
- `null`/`undefined` con `required` -> error `campo requerido`; sin `required` -> válido.
- Tipo incorrecto -> un error `se esperaba <type>` en el path actual.
- Las constraints se evalúan solo si su clave está declarada en el esquema.
- Objetos: recursa sobre `schema.properties`, construyendo paths `padre.hijo`.
- Arrays: recursa por índice, construyendo paths `[i]`.
- No lanza; todo error se acumula en `errors`.

## Examples
- `validate('hola', { type: 'string' })` -> `{ valid: true, errors: [] }`
- `validate(42, { type: 'string' })` -> `{ valid: false, errors: [{ path: '', message: 'se esperaba string' }] }`
- `validate(undefined, { type: 'string', required: true })` -> `valid: false` con un error.
- `validate(5, { type: 'number', minimum: 10 })` -> `valid: false`.
- `validate({ name: 'Ana', address: {} }, schema)` con `address.city` requerido -> error en path `address.city`.
- `validate([1, 'x', 3], { type: 'array', items: { type: 'number' } })` -> error en path `[1]`.

## Do / Don't
- DO: acumular todos los errores de hijos recursivamente.
- DO: propagar el `path` para que cada error indique su ubicación exacta.
- DON'T: lanzar excepciones; reportar todo como errores en el resultado.
- DON'T: mutar `value` ni `schema`.
- DON'T: evaluar constraints no declaradas en el esquema.

## Tests
Property-tests congelados en `ccdd/validation/test_validate.js` (oráculo independiente, no importa el target):
- Escalar string correcto; tipo incorrecto; `required` ausente; opcional ausente válido.
- Constraints `minimum`/`maximum`, `minLength`/`maxLength`, `enum`; objeto anidado reporta path `padre.hijo`; array reporta path con índice; objeto válido completo.

## Constraints
- Budget: cyclomatic ≤ 10, nesting ≤ 3, params ≤ 4, lines ≤ 45.
- `deps_allowed: []` — sin dependencias externas; `forbids: [eval, exec]`.
- Recursión solo por `properties` (object) e `items` (array).
- PARAR y reportar si el gate excede el budget o si un error de hijo no reporta su path completo.
