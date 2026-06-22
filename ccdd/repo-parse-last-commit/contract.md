---
task: repo-parse-last-commit
intent: Parsear la salida de git log -1 a un objeto commit devolviendo null si no hay
target: ../../lib/gitRepos.js
language: javascript
signature: "function parseLastCommitOutput(stdout)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 1, lines_max: 15 }
deps_allowed: []
forbids: [eval, exec]
tests: test_parse_last_commit.js
test_command: "node --test ../ccdd/repo-parse-last-commit/test_parse_last_commit.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Parsear la salida de `git log -1 --format=%H|%an|%aI|%s` a un objeto `{ hash, author, date, message }`, o `null` si no hay commit.

## Interface
- `parseLastCommitOutput(stdout: string) -> { hash: string, author: string, date: string, message: string } | null`
- `stdout`: salida cruda de git (una línea con campos separados por `|`).
- Devuelve `null` si la entrada trimeada es vacía o tiene menos de 4 campos.

## Invariants
- Entrada vacía o solo espacios -> `null`.
- Línea con `< 4` campos separados por `|` -> `null`.
- `message` es el resto de campos unidos por `|` (el mensaje puede contener `|`).
- No lanza.
- No muta la entrada.

## Examples
- `parseLastCommitOutput('')` -> `null`
- `parseLastCommitOutput('   \n  ')` -> `null`
- `parseLastCommitOutput('abc123|Ana|2026-06-21T10:00:00+00:00|fix bug')` -> `{ hash:'abc123', author:'Ana', date:'2026-06-21T10:00:00+00:00', message:'fix bug' }`
- `parseLastCommitOutput('h|A|d|msg|con|pipe')` -> `{ hash:'h', author:'A', date:'d', message:'msg|con|pipe' }`
- `parseLastCommitOutput('a|b|c')` -> `null`

## Do / Don't
- DO: trimear la entrada antes de evaluar.
- DO: reconstruir el mensaje uniendo los campos sobrantes con `|`.
- DON'T: lanzar excepciones.
- DON'T: asumir que el mensaje no contiene `|`.

## Tests
Property-tests congelados en `ccdd/repo-parse-last-commit/test_parse_last_commit.js`:
- Vacío y solo espacios -> `null`; parseo correcto de 4 campos; mensaje con `|` se reconstruye; menos de 4 campos -> `null`.

## Constraints
- Budget: cyclomatic ≤ 6, nesting ≤ 2, params ≤ 1, lines ≤ 15.
- `deps_allowed: []`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si un mensaje con `|` se trunca.