---
task: pr-state
intent: Actualizar el estado de un pull request persistiendo el cambio
target: ../../lib/pulls.js
language: javascript
signature: "async function setPullState(repoName, pullsDir, number, state)"
budget: { cyclomatic_max: 4, nesting_max: 2, params_max: 4, lines_max: 16 }
deps_allowed: ['./gitRepos']
forbids: [eval, exec]
tests: test_pr_state.js
test_command: "node --test ../ccdd/pr-state/test_pr_state.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Cerrar o reabrir un PR estableciendo su `state` a `'open'` o `'closed'`, persistiendo el cambio. El estado `'merged'` NO es válido aquí (solo se alcanza vía `mergePull`).

## Interface
- `setPullState(repoName, pullsDir, number, state: 'open'|'closed') -> Promise<pull>`
- Lanza `PullError('invalid_state')` si `state` no es `'open'` ni `'closed'`.
- Lanza `PullError('not_found')` si el PR no existe.
- Lanza `RepoError('invalid_name')` si el repo es inválido.

## Invariants
- Solo acepta `'open'` o `'closed'`; `'merged'` lanza `invalid_state`.
- Actualiza `updatedAt`.
- Persiste atómicamente.

## Examples
- PR open; `setPullState('r',d,1,'closed')` -> `pull.state === 'closed'`.
- `setPullState('r',d,1,'open')` -> reabre.
- `setPullState('r',d,1,'merged')` -> lanza `invalid_state`.
- `setPullState('r',d,99,'open')` -> lanza `not_found`.

## Do / Don't
- DO: validar `state` antes de leer el store.
- DON'T: aceptar `'merged'` (es dominio de `mergePull`).

## Tests
Property-tests congelados en `ccdd/pr-state/test_pr_state.js` (oráculo independiente: escribe store con fs directo):
- cierra; reabre; `merged` lanza invalid_state; número inexistente lanza not_found.

## Constraints
- Budget: cyclomatic ≤ 4, nesting ≤ 2, params ≤ 4, lines ≤ 16.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si `merged` es aceptado como estado manual.