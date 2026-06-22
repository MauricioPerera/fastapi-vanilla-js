---
task: pr-parse-commits
intent: Parsear la salida de git log a una lista de commits
target: ../../lib/pulls.js
language: javascript
signature: "function parseCommitsOutput(stdout)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 1, lines_max: 24 }
deps_allowed: []
forbids: [eval, exec]
tests: test_parse_commits.js
test_command: "node --test ../ccdd/pr-parse-commits/test_parse_commits.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Parsear la salida de `git log --format=%H|%an|%aI|%s` a un array de commits `{hash, author, date, message}`, trimeando líneas y descartando vacías.

## Interface
- `parseCommitsOutput(stdout: string) -> Array<{hash, author, date, message}>`
- Devuelve array en el orden original. Sin lanza.

## Invariants
- Salida vacía -> `[]`.
- Líneas vacías se descartan.
- Cada línea se parte por `|` en 4 campos: `hash, author, date, message` (message = resto unido por `|`).
- Línea con < 4 campos -> se omite (no lanza).
- No muta la entrada.

## Examples
- `parseCommitsOutput('')` -> `[]`
- `parseCommitsOutput('abc|Ana|2024-01-01T00:00:00Z|fix\n')` -> `[{hash:'abc', author:'Ana', date:'2024-01-01T00:00:00Z', message:'fix'}]`
- `parseCommitsOutput('a|A|d|m1\nb|B|d|m2\n')` -> 2 commits.
- `parseCommitsOutput('a|A|d|msg con | pipe\n')` -> message = `'msg con | pipe'`.

## Do / Don't
- DO: unir el resto tras el 3er `|` como message.
- DO: omitir líneas con < 4 campos.
- DON'T: lanzar.
- DON'T: incluir líneas vacías.

## Tests
Property-tests congelados en `ccdd/pr-parse-commits/test_parse_commits.js` (oráculo independiente: solo importa la función del target):
- vacío -> []; un commit; varios commits; message con `|`; línea con < 4 campos se omite.

## Constraints
- Budget: cyclomatic ≤ 5, nesting ≤ 2, params ≤ 1, lines ≤ 24.
- `deps_allowed: []`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si una línea vacía aparece en el resultado.