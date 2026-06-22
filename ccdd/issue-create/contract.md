---
task: issue-create
intent: Crear un issue con numero autoincremental por repo
target: ../../lib/issues.js
language: javascript
signature: "async function createIssue(repoName, issuesDir, data)"
budget: { cyclomatic_max: 8, nesting_max: 2, params_max: 3, lines_max: 25 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_issue_create.js
test_command: "node --test ../ccdd/issue-create/test_issue_create.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Crear un issue dentro del store de un repo, asignándole el número autoincremental siguiente y estado `open`, persistiendo atómicamente.

## Interface
- `createIssue(repoName: string, issuesDir: string, data: { title, body?, labels? }) -> Promise<issue>`
- `issue = { number, title, body, labels: string[], state: 'open', createdAt, updatedAt, comments: [] }`
- Lanza `IssueError('invalid_body')` si `data` no es objeto o `title` está vacío.
- Lanza `IssueError('invalid_body')` si `labels` no es array.
- Lanza `RepoError('invalid_name')` (vía `sanitizeRepoName`) si el nombre de repo es inválido.

## Invariants
- El número del issue es `store.nextNumber` antes de insertar; tras crear, `nextNumber` se incrementa en 1.
- El primer issue de un repo recibe `number: 1`.
- `state` siempre es `'open'` al crear.
- `comments` nace como array vacío.
- `createdAt === updatedAt` al crear.
- `labels` se normaliza a strings no vacíos; omitidas => `[]`.
- `body` omitido => `''`.
- La persistencia es atómica (tmp + rename); el store se crea si no existía.

## Examples
- `createIssue('r', <tmp>, { title: 'Bug', body: 'x', labels: ['bug'] })` -> `{ number: 1, title: 'Bug', body: 'x', labels: ['bug'], state: 'open', comments: [] }`.
- `createIssue('r', <tmp>, { title: 'Segundo' })` sobre store con `nextNumber: 5` -> `issue.number === 5` y store queda `nextNumber: 6`.
- `createIssue('r', <tmp>, { body: 'x' })` -> lanza `invalid_body` (sin title).
- `createIssue('../bad', <tmp>, { title: 'x' })` -> lanza `invalid_name`.

## Do / Don't
- DO: sanitizar el nombre de repo antes de tocar disco.
- DO: incrementar `nextNumber` y persistir.
- DON'T: asignar `state` distinto de `'open'`.
- DON'T: aceptar `labels` que no sea array (lanza `invalid_body`).

## Tests
Property-tests congelados en `ccdd/issue-create/test_issue_create.js` (oráculo independiente: usa fs/os directos y un helper de store propio, no importa internos del target):
- Crea el primer issue con `number: 1`, `state: 'open'`, `comments: []` y persiste un archivo JSON.
- Segunda llamada recibe `number: 2` (autoincremento) y el store queda con `nextNumber: 3`.
- `title` vacío lanza `invalid_body`; `labels` no-array lanza `invalid_body`.
- Nombre de repo con path traversal lanza `invalid_name`.

## Constraints
- Budget: cyclomatic ≤ 8, nesting ≤ 2, params ≤ 3, lines ≤ 25.
- `deps_allowed: ['./gitRepos']` (reusa `sanitizeRepoName`); `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si dos creaciones consecutivas devuelven el mismo número.