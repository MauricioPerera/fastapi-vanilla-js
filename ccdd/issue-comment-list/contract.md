---
task: issue-comment-list
intent: Listar los comentarios de un issue
target: ../../lib/issues.js
language: javascript
signature: "async function listComments(repoName, issuesDir, number)"
budget: { cyclomatic_max: 2, nesting_max: 1, params_max: 3, lines_max: 6 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_issue_comment_list.js
test_command: "node --test ../ccdd/issue-comment-list/test_issue_comment_list.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Listar los comentarios de un issue, devolviendo una copia del array.

## Interface
- `listComments(repoName, issuesDir, number) -> Promise<comment[]>`
- Lanza `IssueError('not_found')` si el issue no existe.
- Lanza `RepoError('invalid_name')` si el nombre de repo es inválido.

## Invariants
- Issue sin comentarios => `[]`.
- El resultado es una copia (mutarla no afecta al store).
- Orden: el de inserción (no reordena).

## Examples
- `listComments('r', <tmp con #1 con 2 comentarios>, 1)` -> array de 2 comentarios.
- `listComments('r', <tmp con #1 sin comentarios>, 1)` -> `[]`.
- `listComments('r', <tmp>, 99)` -> lanza `not_found`.

## Do / Don't
- DO: devolver una copia (`.slice()`).
- DON'T: lanzar si el issue existe pero no tiene comentarios.
- DON'T: mutar el array del store.

## Tests
Property-tests congelados en `ccdd/issue-comment-list/test_issue_comment_list.js` (oráculo independiente: siembra via `addComment`):
- Issue con comentarios => lista con esos comentarios en orden.
- Issue sin comentarios => `[]`.
- Issue inexistente => lanza `not_found`.

## Constraints
- Budget: cyclomatic ≤ 2, nesting ≤ 1, params ≤ 3, lines ≤ 6.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si listComments lanza para un issue existente sin comentarios.