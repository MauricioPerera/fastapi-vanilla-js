---
task: pr-commits
intent: Listar los commits de un pull request en el rango base..head
target: ../../lib/pulls.js
language: javascript
signature: "async function getPrCommits(repoPath, head, base)"
budget: { cyclomatic_max: 3, nesting_max: 1, params_max: 3, lines_max: 16 }
deps_allowed: []
forbids: [eval]
tests: test_pr_commits.js
test_command: "node --test ../ccdd/pr-commits/test_pr_commits.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Devolver los commits que están en `head` y no en `base` (`git log base..head`) parseados a `{hash, author, date, message}[]`.

## Interface
- `getPrCommits(repoPath, head: string, base: string) -> Promise<commit[]>`
- Lanza `PullError('invalid_branch')` si `head`/`base` son inválidos.
- Si no hay commits en el rango -> `[]`.

## Invariants
- Ejecuta `git log --format=%H|%an|%aI|%s <base>..<head>` en `repoPath` y parsea con `parseCommitsOutput`.
- El rango se pasa como un solo argv `<base>..<head>` (con los nombres sanitizados).
- No lanza por git sin commits; devuelve `[]`.

## Examples
- Repo con `feat` 1 commit sobre `main`; `getPrCommits(repo,'feat','main')` -> 1 commit con author 'Ana'.
- `head === base` -> `[]`.
- `getPrCommits(repo,'a..b','main')` -> lanza `invalid_branch`.

## Do / Don't
- DO: sanitizar `head` y `base` antes de construir el rango.
- DO: delegar el parseo en `parseCommitsOutput`.
- DON'T: ejecutar shell.

## Tests
Property-tests congelados en `ccdd/pr-commits/test_pr_commits.js` (oráculo independiente: repo bare real con ramas; cuenta commits con git directo):
- feat con 1 commit sobre main -> 1 commit con author correcto; head===base -> []; rama con `..` -> invalid_branch.

## Constraints
- Budget: cyclomatic ≤ 3, nesting ≤ 1, params ≤ 3, lines ≤ 16.
- `deps_allowed: []`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si head===base devuelve commits.