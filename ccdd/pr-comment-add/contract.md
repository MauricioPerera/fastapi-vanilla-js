---
task: pr-comment-add
intent: Anadir un comentario a un pull request
target: ../../lib/pulls.js
language: javascript
signature: "async function addPullComment(repoName, pullsDir, number, data)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 4, lines_max: 20 }
deps_allowed: ['./gitRepos']
forbids: [eval, exec]
tests: test_pr_comment_add.js
test_command: "node --test ../ccdd/pr-comment-add/test_pr_comment_add.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Añadir un comentario a un PR existente, actualizando `updatedAt` y persistiendo.

## Interface
- `addPullComment(repoName, pullsDir, number, data: { author?, body }) -> Promise<comment>`
- `comment = { author, body, createdAt }`.
- Lanza `PullError('invalid_body')` si `data` no es objeto o `body` está vacío.
- Lanza `PullError('not_found')` si el PR no existe.
- Lanza `RepoError('invalid_name')` si el repo es inválido.

## Invariants
- `body` debe ser string no vacío tras trim (se guarda crudo, sin trim).
- `author` omitido o no-string -> `'anonymous'`.
- El comentario se apenda a `pull.comments`.
- `pull.updatedAt` se setea al `createdAt` del comentario.
- Persistencia atómica.

## Examples
- `addPullComment('r',d,1,{ author:'Ana', body:'lgtm' })` -> `{ author:'Ana', body:'lgtm', createdAt }`.
- `addPullComment('r',d,1,{ body:'x' })` -> `author === 'anonymous'`.
- `addPullComment('r',d,1,{ author:'A' })` -> lanza `invalid_body` (sin body).
- `addPullComment('r',d,99,{ body:'x' })` -> lanza `not_found`.

## Do / Don't
- DO: validar body antes de leer el store.
- DO: default `author` a `'anonymous'`.
- DON'T: trimar el body al guardarlo (sí validar que no quede vacío tras trim).

## Tests
Property-tests congelados en `ccdd/pr-comment-add/test_pr_comment_add.js` (oráculo independiente: escribe store con fs directo):
- añade comentario con author; default anonymous; body vacío lanza invalid_body; PR inexistente lanza not_found; updatedAt se actualiza.

## Constraints
- Budget: cyclomatic ≤ 6, nesting ≤ 2, params ≤ 4, lines ≤ 20.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si un body vacío es aceptado.