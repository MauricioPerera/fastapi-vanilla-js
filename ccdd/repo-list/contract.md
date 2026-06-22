---
task: repo-list
intent: Listar los repositorios bare existentes bajo un directorio
target: ../../lib/gitRepos.js
language: javascript
signature: "async function listRepos(reposDir)"
budget: { cyclomatic_max: 10, nesting_max: 3, params_max: 1, lines_max: 25 }
deps_allowed: []
forbids: [eval]
tests: test_list_repos.js
test_command: "node --test ../ccdd/repo-list/test_list_repos.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Listar los repositorios bare (subdirectorios `*.git` con `HEAD`) bajo `reposDir`, devolviéndolos ordenados por nombre.

## Interface
- `listRepos(reposDir: string) -> Promise<Array<{ name: string, path: string }>>`
- `reposDir`: directorio base donde viven los `*.git`.
- Devuelve `[]` si `reposDir` no existe.
- Cada item: `{ name }` sin el sufijo `.git`, `path` absoluto al bare repo.

## Invariants
- `reposDir` inexistente -> `[]` (sin lanzar).
- Solo se incluyen subdirectorios cuyo nombre termina en `.git` y que contienen `HEAD`.
- El resultado está ordenado alfabéticamente por `name`.
- Directorios `*.git` sin `HEAD` (no-bare / corruptos) se excluyen.

## Examples
- `listRepos(<no-existe>)` -> `[]`
- `listRepos(<dir con alpha.git y beta.git>)` -> `[{name:'alpha',...},{name:'beta',...}]`
- `listRepos(<dir con notgit.git sin HEAD>)` -> excluye `notgit`.

## Do / Don't
- DO: ordenar el resultado por nombre.
- DO: excluir `*.git` sin `HEAD`.
- DON'T: lanzar si `reposDir` no existe.
- DON'T: incluir archivos sueltos.

## Tests
Property-tests congelados en `ccdd/repo-list/test_list_repos.js` (oráculo independiente, crea bare repos vía `createBareRepo` + `fs`):
- Dir inexistente -> `[]`.
- Lista solo `*.git` bare, ordenados.
- Excluye `*.git` sin `HEAD`.

## Constraints
- Budget: cyclomatic ≤ 10, nesting ≤ 3, params ≤ 1, lines ≤ 25.
- `deps_allowed: []`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si lista un `*.git` sin `HEAD`.