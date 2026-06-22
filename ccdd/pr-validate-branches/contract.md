---
task: pr-validate-branches
intent: Verificar que dos ramas existen en un repo bare
target: ../../lib/pulls.js
language: javascript
signature: "async function validateBranchesExist(repoPath, head, base)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 3, lines_max: 20 }
deps_allowed: []
forbids: [eval]
tests: test_pr_validate_branches.js
test_command: "node --test ../ccdd/pr-validate-branches/test_pr_validate_branches.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Sanitizar `head` y `base` y verificar que ambas existen como refs `refs/heads/<rama>` en el repo bare, lanzando `PullError('branch_not_found')` claro si alguna falta.

## Interface
- `validateBranchesExist(repoPath, head: string, base: string) -> Promise<{head, base}>`
- Devuelve los nombres sanitizados si ambas existen.
- Lanza `PullError('invalid_branch')` (vía `sanitizeBranchName`) si `head`/`base` son inválidos.
- Lanza `PullError('branch_not_found')` si alguna rama no existe en el repo.

## Invariants
- Usa `git show-ref --verify --quiet refs/heads/<rama>` en `repoPath` para cada rama.
- Si `head` no existe -> lanza `branch_not_found` mencionando `head`.
- Si `base` no existe -> lanza `branch_not_found` mencionando `base`.
- El orden de verificación es `head` primero, luego `base`.

## Examples
- Repo con ramas `main` y `feat`; `validateBranchesExist(repoPath,'feat','main')` -> `{head:'feat', base:'main'}`.
- `validateBranchesExist(repoPath,'missing','main')` -> lanza `branch_not_found` (head).
- `validateBranchesExist(repoPath,'feat','missing')` -> lanza `branch_not_found` (base).
- `validateBranchesExist(repoPath,'a..b','main')` -> lanza `invalid_branch`.

## Do / Don't
- DO: sanitizar antes de pasar a git (evita metacaracteres en el ref).
- DO: pasar `refs/heads/<rama>` como argv separado (sin shell).
- DON'T: ejecutar shell.
- DON'T: lanzar `branch_not_found` si la rama sí existe.

## Tests
Property-tests congelados en `ccdd/pr-validate-branches/test_pr_validate_branches.js` (oráculo independiente: crea repo bare real con git + ramas):
- ambas existen -> ok; head missing -> branch_not_found; base missing -> branch_not_found; rama con `..` -> invalid_branch.

## Constraints
- Budget: cyclomatic ≤ 5, nesting ≤ 2, params ≤ 3, lines ≤ 20.
- `deps_allowed: []`; `forbids: [eval]` (exec sí permitido: la función usa git).
- PARAR y reportar si el gate excede el budget o si una rama inexistente no lanza branch_not_found.