---
task: action-save-workflow
intent: Persistir un workflow validado en disco
target: ../../lib/actions.js
language: javascript
signature: "async function saveWorkflow(repoName, workflowsDir, workflow)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 3, lines_max: 12 }
deps_allowed: ['./gitRepos']
forbids: [eval]
tests: test_save_workflow.js
test_command: "node --test ../ccdd/action-save-workflow/test_save_workflow.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Validar y persistir un workflow en `<workflowsDir>/<repo>/<wfName>.json`, devolviendo `{ repo, name, path }`.

## Interface
- `saveWorkflow(repoName, workflowsDir, workflow) -> Promise<{ repo, name, path }>`
- Sanitiza `repoName` y el `name` del workflow con `sanitizeRepoName`.
- Lanza `RepoError('invalid_name')` si el repo o el nombre de workflow son inválidos.
- Lanza `ActionError('invalid_workflow')` (vía `validateWorkflow`) si el workflow es inválido.

## Invariants
- El archivo se escribe atómicamente (tmp + rename) en `<workflowsDir>/<safeRepo>/<safeName>.json`.
- El contenido persistido es `{ name, trigger, steps }` (sin metadata extra).
- `path` termina en `<safeName>.json`.
- `name` persistido es el nombre sanitizado.

## Examples
- `saveWorkflow('r', <tmp>, { name: 'build', trigger: 'push', steps: ['c'] })` -> crea `<tmp>/r/build.json` con el workflow normalizado.
- `saveWorkflow('../bad', <tmp>, { name: 'w', trigger: 'manual', steps: ['c'] })` -> lanza `invalid_name`.
- `saveWorkflow('r', <tmp>, { name: 'w', trigger: 'bad', steps: ['c'] })` -> lanza `invalid_workflow`.

## Do / Don't
- DO: sanitizar repo y nombre de workflow antes de escribir.
- DO: escribir atómicamente.
- DON'T: persistir metadata no validada.
- DON'T: permitir path traversal en el nombre del workflow.

## Tests
Property-tests congelados en `ccdd/action-save-workflow/test_save_workflow.js` (oráculo independiente: lee el JSON del disco con fs directo y verifica forma y normalización):
- Guarda el workflow en `<repo>/<name>.json` con la forma correcta y steps normalizados.
- `name` se sanitiza (rechaza path traversal en el nombre del workflow).
- Repo con path traversal lanza `invalid_name`.

## Constraints
- Budget: cyclomatic ≤ 5, nesting ≤ 2, params ≤ 3, lines ≤ 12.
- `deps_allowed: ['./gitRepos']` (reusa `sanitizeRepoName`); `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si persiste un workflow sin validar.