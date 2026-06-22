---
task: serialize-value-by-response-model
intent: Filtrar un valor dejando solo los campos declarados por el esquema
target: ../../lib/validation.js
language: javascript
signature: "function serialize(value, schema)"
budget: { cyclomatic_max: 10, nesting_max: 3, params_max: 3, lines_max: 30 }
deps_allowed: []
forbids: [eval, exec]
tests: test_serialize.js
test_command: "node --test ../ccdd/serialize/test_serialize.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Proyectar un valor dejando solo los campos declarados por el esquema (recursivo), equivalente al `response_model` de FastAPI: no expone campos no declarados.

## Interface
- `serialize(value: any, schema: { type: string, ... }) -> any`
- `value`: valor entrante (escalar, objeto, array, `null`/`undefined`).
- `schema`: esquema con `type` y, opcionalmente, `properties` (object) o `items` (array).
- Devuelve el valor proyectado (solo los campos declarados presentes) o el valor original si es escalar/`null`.

## Invariants
- `null` y `undefined` pasan sin proyectar (evita `{}` espurio).
- Objetos: el resultado contiene solo las claves declaradas en `schema.properties` que existan en `value`; recursa sobre cada una.
- Arrays: proyecta cada elemento contra `schema.items`.
- Escalares (`number`/`string`/`boolean`): se devuelven sin cambios.
- No muta la entrada: construye objetos nuevos.

## Examples
- `serialize(null, { type: 'object', properties: { a: { type: 'number' } } })` -> `null`
- `serialize({ a: 1, b: 2, secret: 9 }, { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } })` -> `{ a: 1, b: 2 }`
- `serialize({ name: 'Ana', password: 'x' }, { type: 'object', properties: { name: { type: 'string' } } })` -> `{ name: 'Ana' }`
- `serialize([{ a: 1, b: 2 }, { a: 3, c: 4 }], { type: 'array', items: { type: 'object', properties: { a: { type: 'number' } } } })` -> `[{ a: 1 }, { a: 3 }]`
- `serialize(42, { type: 'number' })` -> `42`

## Do / Don't
- DO: construir objetos nuevos para no mutar la entrada.
- DO: omitir campos declarados ausentes en `value` (no forzar claves).
- DON'T: exponer campos no declarados (`password`, `secret`, extras).
- DON'T: lanzar si `value` no encaja con el tipo esperado; pasarlo sin cambios.
- DON'T: mutar `value` ni `schema`.

## Tests
Property-tests congelados en `ccdd/serialize/test_serialize.js` (oráculo independiente, no importa el target):
- `null`/`undefined` pasan sin proyectar; descarta campo no declarado; no expone `password`.
- Filtra recursivo en objeto anidado; filtra por elemento en array; omite campo declarado ausente; escalar passthrough; no mutación de la entrada.

## Constraints
- Budget: cyclomatic ≤ 10, nesting ≤ 3, params ≤ 3, lines ≤ 30.
- `deps_allowed: []` — sin dependencias externas; `forbids: [eval, exec]`.
- Recursión solo por `properties` (object) e `items` (array).
- PARAR y reportar si el gate excede el budget o si un campo no declarado (p. ej. `password`) aparece en la salida.
