---
task: pr-get
intent: Obtener un pull request por su numero
target: ../../lib/pulls.js
language: javascript
signature: "async function getPull(repoName, pullsDir, number)"
budget: { cyclomatic_max: 3, nesting_max: 1, params_max: 3, lines_max: 14 }
deps_allowed: ['./gitRepos']
forbids: [eval, exec]
tests: test_pr_get.js
test_command: "node --test ../ccdd/pr-get/test_pr_get.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Devolver un PR por su número dentro del store del repo.

## Interface
- `getPull(repoName, pullsDir, number: number) -> Promise<pull>`
- Lanza `PullError('not_found')` si no existe.
- Lanza `RepoError('invalid_name')` si el repo es inválido.

## Invariants
- Devuelve el PR tal cual está en el store.
- Repo sin store y número cualquiera -> `not_found`.

## Examples
- Store con PR #1; `getPull('r',d,1)` -> ese PR.
- `getPull('r',d,99)` -> lanza `not_found`.

## Do / Don't
- DO: delegar en `findPull` (helper interno).
- DON'T: mutar el store.

## Tests
Property-tests congelados en `ccdd/pr-get/test_pr_get.js` (oráculo independiente: escribe store con fs directo):
- obtiene PR existente; número inexistente lanza not_found; repo sin store lanza not_found.

## Constraints
- Budget: cyclomatic ≤ 3, nesting ≤ 1, params ≤ 3, lines ≤ 14.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si un PR inexistente no lanza not_found.