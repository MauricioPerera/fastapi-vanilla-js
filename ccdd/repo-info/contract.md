---
task: repo-info
intent: Obtener las ramas de un repo bare incluyendo su ultimo commit
target: ../../lib/gitRepos.js
language: javascript
signature: "async function getRepoInfo(name, reposDir)"
budget: { cyclomatic_max: 8, nesting_max: 2, params_max: 2, lines_max: 30 }
deps_allowed: []
forbids: [eval]
tests: test_get_repo_info.js
test_command: "node --test ../ccdd/repo-info/test_get_repo_info.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Obtener la info de un repo bare: lista de ramas y último commit, devolviendo `lastCommit: null` cuando no hay commits.

## Interface
- `getRepoInfo(name: string, reposDir: string) -> Promise<{ name: string, path: string, branches: string[], lastCommit: { hash, author, date, message } | null }>`
- Lanza `RepoError('not_found', ...)` si el repo no existe; `RepoError('invalid_name', ...)` si el nombre es inválido.
- Ramas vía `git branch --format=%(refname:short)` (parseado con `parseBranchesOutput`).
- Último commit vía `git log -1 --format=%H|%an|%aI|%s` (parseado con `parseLastCommitOutput`); `null` si `git log` falla (repo sin commits).

## Invariants
- Repo inexistente -> lanza `not_found`.
- Repo recién creado (sin commits) -> `branches: []`, `lastCommit: null`.
- `lastCommit` es `null` cuando no hay commits (no lanza por el fallo de `git log`).
- Las ramas se devuelven trimeadas y sin líneas vacías.

## Examples
- `getRepoInfo('empty', <dir con empty.git sin commits>)` -> `{ name:'empty', branches:[], lastCommit:null, ... }`.
- `getRepoInfo('nope', <dir>)` -> lanza `not_found`.
- Repo con un commit pusheado a su rama por defecto -> `branches` incluye esa rama, `lastCommit.author` y `lastCommit.message` reflejan el commit.

## Do / Don't
- DO: degradar `git log` fallido a `lastCommit: null`.
- DO: delegar parseo a `parseBranchesOutput`/`parseLastCommitOutput`.
- DON'T: lanzar si `git log` falla por ausencia de commits.
- DON'T: devolver ramas con líneas vacías.

## Tests
Property-tests congelados en `ccdd/repo-info/test_get_repo_info.js` (oráculo independiente, usa `child_process` directo para sembrar git state):
- Repo vacío -> `branches: []`, `lastCommit: null`.
- Repo inexistente -> lanza `not_found`.
- Repo con commit pusheado -> rama por defecto presente y `lastCommit` con author/message correctos.

## Constraints
- Budget: cyclomatic ≤ 8, nesting ≤ 2, params ≤ 2, lines ≤ 30.
- `deps_allowed: []`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si un repo sin commits lanza en lugar de devolver `lastCommit: null`.