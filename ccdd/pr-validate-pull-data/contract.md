---
task: pr-validate-pull-data
intent: Validar los campos requeridos de un pull request
target: ../../lib/pulls.js
language: javascript
signature: "function validatePullData(data)"
budget: { cyclomatic_max: 8, nesting_max: 2, params_max: 1, lines_max: 12 }
deps_allowed: []
forbids: [eval, exec]
tests: test_validate_pull_data.js
test_command: "node --test ../ccdd/pr-validate-pull-data/test_validate_pull_data.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Validar que `data` es objeto con `title`, `head` y `base` strings no vacíos, devolviéndolos normalizados o lanzando `PullError('invalid_body')`.

## Interface
- `validatePullData(data) -> { title, head, base }`
- `title` se devuelve trimado; `head` y `base` crudos (la sanitización de rama la hace el caller).
- Lanza `PullError('invalid_body')` si `data` no es objeto, o `title`/`head`/`base` no son string no vacíos tras trim.

## Invariants
- `title` no vacío tras trim.
- `head` y `base` no vacíos tras trim.
- No toca disco; función pura.

## Examples
- `validatePullData({ title:'T', head:'feat', base:'main' })` -> `{ title:'T', head:'feat', base:'main' }`.
- `validatePullData({ title:'  T  ', head:'feat', base:'main' })` -> `title === 'T'`.
- `validatePullData({ head:'feat', base:'main' })` -> lanza `invalid_body` (sin title).
- `validatePullData({ title:'T', head:'feat' })` -> lanza `invalid_body` (sin base).
- `validatePullData(null)` -> lanza `invalid_body`.

## Do / Don't
- DO: devolver `title` trimado.
- DO: devolver `head`/`base` crudos (sin trimar).
- DON'T: sanitizar ramas (eso es del caller).
- DON'T: validar que las ramas existan en git.

## Tests
Property-tests congelados en `ccdd/pr-validate-pull-data/test_validate_pull_data.js` (oráculo independiente):
- campos válidos -> {title trimado, head, base}; sin title -> invalid_body; sin base -> invalid_body; sin head -> invalid_body; data null -> invalid_body; title vacío tras trim -> invalid_body.

## Constraints
- Budget: cyclomatic ≤ 8, nesting ≤ 2, params ≤ 1, lines ≤ 12.
- `deps_allowed: []`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si un campo vacío es aceptado.