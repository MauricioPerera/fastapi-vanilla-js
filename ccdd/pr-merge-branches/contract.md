---
task: pr-merge-branches
intent: Mergear head dentro de base en un repo bare via worktree temporal
target: ../../lib/pulls.js
language: javascript
signature: "async function mergeBranches(repoPath, base, head)"
budget: { cyclomatic_max: 4, nesting_max: 2, params_max: 3, lines_max: 34 }
deps_allowed: []
forbids: [eval]
tests: test_pr_merge_branches.js
test_command: "node --test ../ccdd/pr-merge-branches/test_pr_merge_branches.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Hacer el merge real de `head` dentro de `base` en el repo bare usando un worktree temporal (zero-dep): el ref `refs/heads/<base>` avanza solo si el merge commitea; si hay conflicto se descarta el worktree y el bare queda intacto. Devuelve el SHA del commit resultante (merge o fast-forward).

## Interface
- `mergeBranches(repoPath, base: string, head: string) -> Promise<{mergeCommitSha}>`
- Lanza `PullError('invalid_branch')` si `base`/`head` son inválidos.
- Lanza `PullError('merge_conflict')` si el merge no commitea por conflicto.

## Invariants
- Crea un worktree temporal en un tmpdir sobre `base`, ejecuta `git merge --no-edit <head>`, lee `HEAD` como SHA.
- Éxito -> devuelve `{mergeCommitSha: sha}` (FF o merge commit).
- Conflicto (git merge falla) -> lanza `merge_conflict`, SIEMPRE limpiando el worktree en el `finally`.
- El worktree se elimina (worktree remove --force + rm) aunque haya éxito o error; no deja estado roto.
- Las ramas se pasan como argv separados (sin shell).

## Examples
- Repo con `feat` 1 commit sobre `main`; `mergeBranches(repo,'main','feat')` -> `{mergeCommitSha}` no vacío y `refs/heads/main` avanza al SHA.
- `head` ya mergueada en `base` -> devuelve el SHA actual de base (Already up to date).
- `head` con conflicto frente a `base` -> lanza `merge_conflict`; base NO avanza.
- `mergeBranches(repo,'a..b','feat')` -> lanza `invalid_branch`.

## Do / Don't
- DO: sanitizar `base` y `head`.
- DO: limpiar el worktree en `finally` (éxito o error).
- DON'T: dejar el worktree o el repo en estado roto.
- DON'T: ejecutar shell.

## Tests
Property-tests congelados en `ccdd/pr-merge-branches/test_pr_merge_branches.js` (oráculo independiente: repo bare real; verifica avance del ref con git directo):
- merge limpio -> SHA no vacío y refs/heads/main avanza a ese SHA; Already up to date -> SHA actual de base; conflicto -> merge_conflict y base no avanza; rama con `..` -> invalid_branch; el worktree se limpia (no queda en `git worktree list`).

## Constraints
- Budget: cyclomatic ≤ 4, nesting ≤ 2, params ≤ 3, lines ≤ 34.
- `deps_allowed: []`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si tras un conflicto el ref de base avanza o queda un worktree colgado.