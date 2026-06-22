---
task: issue-comment-add
intent: Anadir un comentario a un issue
target: ../../lib/issues.js
language: javascript
signature: "async function addComment(repoName, issuesDir, number, data)"
budget: { cyclomatic_max: 8, nesting_max: 1, params_max: 4, lines_max: 18 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_issue_comment_add.js
test_command: "node --test ../ccdd/issue-comment-add/test_issue_comment_add.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Añadir un comentario al final de la lista de comentarios de un issue, persistiendo y devolviendo el comentario creado.

## Interface
- `addComment(repoName, issuesDir, number, data: { author?, body }) -> Promise<comment>`
- `comment = { author, body, createdAt }`
- Lanza `IssueError('invalid_body')` si `data` no es objeto o `body` está vacío/no-string.
- Lanza `IssueError('not_found')` si el issue no existe.
- `author` omitido o no-string => `'anonymous'`.

## Invariants
- El comentario se añade al final de `issue.comments`.
- `issue.updatedAt` se actualiza al `createdAt` del comentario.
- El `number` del issue no cambia.
- El cambio persiste atómicamente.

## Examples
- `addComment('r', <tmp con #1>, 1, { author: 'alicia', body: 'hola' })` -> `{ author: 'alicia', body: 'hola', createdAt }`.
- `addComment('r', <tmp con #1>, 1, { body: 'x' })` -> `comment.author === 'anonymous'`.
- `addComment('r', <tmp>, 1, { author: 'a' })` -> lanza `invalid_body` (sin body).
- `addComment('r', <tmp>, 99, { body: 'x' })` -> lanza `not_found`.

## Do / Don't
- DO: validar `body` antes de buscar el issue.
- DO: defaults `author` a `'anonymous'`.
- DON'T: insertar comentario si el issue no existe.

## Tests
Property-tests congelados en `ccdd/issue-comment-add/test_issue_comment_add.js` (oráculo independiente: verifica con fs directo):
- Comentario con autor se persiste y aparece en el issue.
- `author` omitido => `'anonymous'`.
- `body` vacío lanza `invalid_body`.
- Issue inexistente lanza `not_found`.

## Constraints
- Budget: cyclomatic ≤ 8, nesting ≤ 1, params ≤ 4, lines ≤ 18.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si addComment acepta body vacío.