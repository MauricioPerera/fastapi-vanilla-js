---
task: repo-parse-branches
intent: Parsear la salida de git branch a un array de nombres de rama trimeados
target: ../../lib/gitRepos.js
language: javascript
signature: "function parseBranchesOutput(stdout)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 1, lines_max: 10 }
deps_allowed: []
forbids: [eval, exec]
tests: test_parse_branches.js
test_command: "node --test ../ccdd/repo-parse-branches/test_parse_branches.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Parsear la salida de `git branch --format=%(refname:short)` a un array de nombres de rama, trimeando líneas y descartando vacías.

## Interface
- `parseBranchesOutput(stdout: string) -> string[]`
- `stdout`: salida cruda de git (una rama por línea, puede tener líneas vacías al final).
- Devuelve un array de strings no vacíos y trimeados, en el orden original.

## Invariants
- Salida vacía -> `[]`.
- Líneas con espacios extremos se trimean.
- Líneas que quedan vacías tras el trim se descartan.
- No lanza.
- No muta la entrada.

## Examples
- `parseBranchesOutput('')` -> `[]`
- `parseBranchesOutput('main\n')` -> `['main']`
- `parseBranchesOutput('main\ndev\n')` -> `['main', 'dev']`
- `parseBranchesOutput('  main  \n  dev \n')` -> `['main', 'dev']`
- `parseBranchesOutput('main\n\nfeature/x\n')` -> `['main', 'feature/x']`

## Do / Don't
- DO: trimar cada línea antes de filtrar.
- DO: conservar el orden original.
- DON'T: lanzar excepciones.
- DON'T: incluir líneas vacías en el resultado.

## Tests
Property-tests congelados en `ccdd/repo-parse-branches/test_parse_branches.js`:
- Vacío -> `[]`; una rama; varias ramas; trim de espacios; líneas vacías intermedias se descartan.

## Constraints
- Budget: cyclomatic ≤ 6, nesting ≤ 2, params ≤ 1, lines ≤ 10.
- `deps_allowed: []`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si una línea vacía aparece en el resultado.