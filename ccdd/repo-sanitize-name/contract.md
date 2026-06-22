---
task: repo-sanitize-name
intent: Sanitizar el nombre de un repo rechazando path traversal
target: ../../lib/gitRepos.js
language: javascript
signature: "function sanitizeRepoName(name)"
budget: { cyclomatic_max: 10, nesting_max: 3, params_max: 1, lines_max: 25 }
deps_allowed: []
forbids: [eval, exec]
tests: test_sanitize_name.js
test_command: "node --test ../ccdd/repo-sanitize-name/test_sanitize_name.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Validar y sanitizar el nombre de un repo, devolviendo el nombre trimado si es seguro, o lanzando `RepoError('invalid_name', ...)` ante path traversal, tipos no-string, vacíos o caracteres fuera del patrón.

## Interface
- `sanitizeRepoName(name: string) -> string`
- `name`: nombre candidato del repo.
- Devuelve el nombre trimado si pasa todas las validaciones.
- Lanza `RepoError` con `code: 'invalid_name'` en caso contrario.

## Invariants
- `typeof name !== 'string'` -> lanza.
- Trimado vacío -> lanza.
- Contiene `..`, `/`, `\` o `\0` -> lanza (guarda de path traversal).
- No matchea `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$` -> lanza.
- El valor devuelto es el trimado (sin espacios extremos).
- No muta la entrada.

## Examples
- `sanitizeRepoName('mi-repo')` -> `'mi-repo'`
- `sanitizeRepoName('  mi-repo  ')` -> `'mi-repo'`
- `sanitizeRepoName('a')` -> `'a'`
- `sanitizeRepoName('My.Repo_2')` -> `'My.Repo_2'`
- `sanitizeRepoName('../etc')` -> lanza (`invalid_name`)
- `sanitizeRepoName('')` -> lanza (`invalid_name`)
- `sanitizeRepoName(42)` -> lanza (`invalid_name`)
- `sanitizeRepoName('repo con espacio')` -> lanza (`invalid_name`)

## Do / Don't
- DO: trimar antes de validar.
- DO: rechazar `..`, `/`, `\`, `\0` antes del regex (path traversal es un riesgo de seguridad).
- DON'T: devolver el nombre sin validar.
- DON'T: aceptar nombres que empiecen con `.` (el regex exige `[a-zA-Z0-9]` inicial).
- DON'T: mutar la entrada.

## Tests
Property-tests congelados en `ccdd/repo-sanitize-name/test_sanitize_name.js` (oráculo independiente):
- Nombres válidos pasan y se triman.
- Vacío / solo espacios lanza.
- Path traversal (`../etc`, `..`, `a/b`, `a\b`, `a\0b`) lanza.
- No-string (número, null) lanza.
- Caracteres fuera del patrón (espacio, `$`) lanzan.

## Constraints
- Budget: cyclomatic ≤ 10, nesting ≤ 3, params ≤ 1, lines ≤ 25.
- `deps_allowed: []`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si una entrada maliciosa no lanza.