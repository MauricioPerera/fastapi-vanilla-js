---
task: pr-comment-list
intent: Listar los comentarios de un pull request
target: ../../lib/pulls.js
language: javascript
signature: "async function listPullComments(repoName, pullsDir, number)"
budget: { cyclomatic_max: 3, nesting_max: 1, params_max: 3, lines_max: 14 }
deps_allowed: ['./gitRepos']
forbids: [eval, exec]
tests: test_pr_comment_list.js
test_command: "node --test ../ccdd/pr-comment-list/test_pr_comment_list.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Devolver la lista de comentarios de un PR por su número.

## Interface
- `listPullComments(repoName, pullsDir, number: number) -> Promise<comment[]>`
- Lanza `PullError('not_found')` si el PR no existe.
- Lanza `RepoError('invalid_name')` si el repo es inválido.

## Invariants
- Devuelve una copia del array de comentarios del PR.
- PR sin comentarios -> `[]`.

## Examples
- PR con 2 comentarios; `listPullComments('r',d,1)` -> array de 2.
- PR sin comentarios -> `[]`.
- `listPullComments('r',d,99)` -> lanza `not_found`.

## Do / Don't
- DO: devolver copia (slice).
- DON'T: mutar el store.

## Tests
Property-tests congelados en `ccdd/pr-comment-list/test_pr_comment_list.js` (oráculo independiente):
- lista comentarios; sin comentarios -> []; PR inexistente lanza not_found.

## Constraints
- Budget: cyclomatic ≤ 3, nesting ≤ 1, params ≤ 3, lines ≤ 14.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si un PR inexistente no lanza not_found.