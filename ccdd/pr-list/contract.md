---
task: pr-list
intent: Listar los pull requests de un repo con filtro de estado
target: ../../lib/pulls.js
language: javascript
signature: "async function listPulls(repoName, pullsDir, stateFilter)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 3, lines_max: 20 }
deps_allowed: ['./gitRepos']
forbids: [eval, exec]
tests: test_pr_list.js
test_command: "node --test ../ccdd/pr-list/test_pr_list.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Listar los PRs de un repo, opcionalmente filtrados por estado (`open`|`closed`|`merged`|`all`).

## Interface
- `listPulls(repoName, pullsDir, stateFilter?: string) -> Promise<pull[]>`
- Lanza `PullError('invalid_state')` si `stateFilter` está definido y no es uno de los válidos.
- Lanza `RepoError('invalid_name')` si el repo es inválido.

## Invariants
- Sin filtro o `stateFilter === 'all'` -> devuelve todos los PRs (copia).
- Filtro válido -> solo los PRs con `state === stateFilter`.
- Sin store -> `[]`.
- Devuelve una copia (no expone el array interno).

## Examples
- Store con 2 PRs open y 1 closed; `listPulls('r',d)` -> 3; `listPulls('r',d,'open')` -> 2; `listPulls('r',d,'closed')` -> 1.
- `listPulls('r',d,'merged')` -> 0.
- `listPulls('r',d,'bogus')` -> lanza `invalid_state`.

## Do / Don't
- DO: validar el filtro si está presente.
- DO: devolver copia.
- DON'T: lanzar si no hay store.

## Tests
Property-tests congelados en `ccdd/pr-list/test_pr_list.js` (oráculo independiente: escribe store con fs directo):
- mezcla de estados filtra bien; `all` devuelve todos; filtro inválido lanza; repo sin store -> [].

## Constraints
- Budget: cyclomatic ≤ 5, nesting ≤ 2, params ≤ 3, lines ≤ 20.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si un filtro válido devuelve PRs de otro estado.