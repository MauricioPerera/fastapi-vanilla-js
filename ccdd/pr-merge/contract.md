---
task: pr-merge
intent: Mergear un pull request abierto marcandolo merged
target: ../../lib/pulls.js
language: javascript
signature: "async function mergePull(repoName, pullsDir, repoPath, number)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 4, lines_max: 24 }
deps_allowed: []
forbids: [eval]
tests: test_pr_merge.js
test_command: "node --test ../ccdd/pr-merge/test_pr_merge.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Mergear el PR `number` (abierto) en el repo bare: llama a `mergeBranches(repoPath, base, head)`, y si tiene éxito marca el PR `state:'merged'`, registra `mergeCommitSha` y `mergedAt`, persistiendo.

## Interface
- `mergePull(repoName, pullsDir, repoPath, number: number) -> Promise<pull>`
- Lanza `PullError('not_found')` si el PR no existe.
- Lanza `PullError('invalid_state')` si el PR no está `'open'` (ya cerrado o ya merged).
- Propaga `PullError('merge_conflict')` desde `mergeBranches`.
- Lanza `RepoError('invalid_name')` si el repo es inválido.

## Invariants
- Solo se mergea si `pull.state === 'open'`; cualquier otro estado -> `invalid_state`.
- Tras merge exitoso: `pull.state = 'merged'`, `pull.mergeCommitSha = sha`, `pull.mergedAt = nowIso()`, `pull.updatedAt = nowIso()`.
- Si `mergeBranches` lanza `merge_conflict`, el PR NO se marca merged (queda open) y la excepción se propaga.
- Persistencia atómica del store solo tras merge exitoso.

## Examples
- PR open head `feat` base `main`; `mergePull('r',d,repo,1)` -> `pull.state === 'merged'`, `pull.mergeCommitSha` no vacío, `pull.mergedAt` seteado.
- PR `closed`; `mergePull('r',d,repo,1)` -> lanza `invalid_state`.
- PR ya `merged`; `mergePull('r',d,repo,1)` -> lanza `invalid_state`.
- PR open con conflicto -> lanza `merge_conflict` y el PR sigue `open` en el store.
- `mergePull('r',d,repo,99)` -> lanza `not_found`.

## Do / Don't
- DO: validar estado open antes de mergear.
- DO: persistir solo tras merge exitoso.
- DON'T: marcar merged si `mergeBranches` falla.
- DON'T: ejecutar shell (delegar git a `mergeBranches`).

## Tests
Property-tests congelados en `ccdd/pr-merge/test_pr_merge.js` (oráculo independiente: repo bare real + store fs directo):
- merge limpio -> state merged, sha no vacío, mergedAt seteado, base avanza; PR closed -> invalid_state; PR merged -> invalid_state; conflicto -> merge_conflict y PR sigue open; inexistente -> not_found.

## Constraints
- Budget: cyclomatic ≤ 5, nesting ≤ 2, params ≤ 4, lines ≤ 24.
- `deps_allowed: []`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si un PR no-open es mergeado o si tras conflicto el PR queda merged.