---
task: pr-create
intent: Crear un pull request con numero autoincremental por repo
target: ../../lib/pulls.js
language: javascript
signature: "async function createPull(repoName, pullsDir, data)"
budget: { cyclomatic_max: 8, nesting_max: 2, params_max: 3, lines_max: 30 }
deps_allowed: ['./gitRepos']
forbids: [eval, exec]
tests: test_pr_create.js
test_command: "node --test ../ccdd/pr-create/test_pr_create.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Crear un PR en el store de un repo con número autoincremental, estado `open`, ramas head/base sanitizadas, persistiendo atómicamente.

## Interface
- `createPull(repoName, pullsDir, data: { title, body?, head, base }) -> Promise<pull>`
- `pull = { number, title, body, head, base, state:'open', createdAt, updatedAt, mergeCommitSha:null, mergedAt:null, comments:[] }`
- Lanza `PullError('invalid_body')` si `data` no es objeto, `title` vacío, o `head`/`base` ausentes.
- Lanza `PullError('invalid_branch')` (vía `sanitizeBranchName`) si `head`/`base` son inválidos.
- Lanza `RepoError('invalid_name')` si el nombre de repo es inválido.

## Invariants
- `number` = `store.nextNumber` antes de insertar; tras crear, `nextNumber` se incrementa en 1.
- Primer PR del repo -> `number: 1`.
- `state` siempre `'open'` al crear; `mergeCommitSha` y `mergedAt` nacen `null`; `comments` nace `[]`.
- `createdAt === updatedAt` al crear.
- `body` omitido -> `''`.
- `head`/`base` se sanitizan antes de guardarse.
- Persistencia atómica (tmp + rename); el store se crea si no existía.

## Examples
- `createPull('r', <tmp>, { title:'T', head:'feat', base:'main' })` -> `{ number:1, title:'T', head:'feat', base:'main', state:'open', mergeCommitSha:null, mergedAt:null, comments:[] }`.
- Segunda llamada sobre store con `nextNumber:5` -> `pull.number === 5` y store queda `nextNumber:6`.
- `createPull('r', <tmp>, { head:'feat', base:'main' })` -> lanza `invalid_body` (sin title).
- `createPull('r', <tmp>, { title:'T', head:'feat' })` -> lanza `invalid_body` (sin base).
- `createPull('r', <tmp>, { title:'T', head:'a..b', base:'main' })` -> lanza `invalid_branch`.

## Do / Don't
- DO: sanitizar repoName y ambas ramas antes de tocar disco.
- DO: incrementar `nextNumber` y persistir.
- DON'T: asignar `state` distinto de `'open'`.
- DON'T: validar que las ramas existan en git (eso es del caller; aquí solo se sanitizan).

## Tests
Property-tests congelados en `ccdd/pr-create/test_pr_create.js` (oráculo independiente: fs/os directos + helper de store propio):
- primer PR number 1, state open, comments [], mergeCommitSha null, persiste JSON.
- segunda llamada autoincrementa.
- title vacío -> invalid_body; base ausente -> invalid_body; rama con `..` -> invalid_branch; repo con path traversal -> invalid_name.

## Constraints
- Budget: cyclomatic ≤ 8, nesting ≤ 2, params ≤ 3, lines ≤ 30.
- `deps_allowed: ['./gitRepos']`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si dos creaciones consecutivas devuelven el mismo número.