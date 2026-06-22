---
task: pr-sanitize-branch
intent: Validar un nombre de rama git para uso seguro en comandos git
target: ../../lib/pulls.js
language: javascript
signature: "function sanitizeBranchName(name)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 1, lines_max: 14 }
deps_allowed: []
forbids: [eval, exec]
tests: test_sanitize_branch.js
test_command: "node --test ../ccdd/pr-sanitize-branch/test_sanitize_branch.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Validar y normalizar un nombre de rama git para usarlo de forma segura como argumento de git (pasado vía execFile, sin shell), rechazando metacaracteres de refspec/rango y path traversal, pero permitiendo ramas anidadas con `/`.

## Interface
- `sanitizeBranchName(name: string) -> string`
- Devuelve el nombre trimeado si es válido.
- Lanza `PullError('invalid_branch')` si `name` no es string, está vacío, o contiene caracteres/secuencias prohibidas.

## Invariants
- `name` no string o vacío tras trim -> lanza `invalid_branch`.
- Empieza con `-` -> lanza `invalid_branch` (git lo interpretaría como opción).
- Contiene `..` -> lanza `invalid_branch` (confunde con operador de rango `base..head`).
- Contiene alguno de `: ~ ^ ? * [ ] { ( ) , @ \ " ' ` o espacio o `\0` o `\` -> lanza `invalid_branch` (metacaracteres de refspec/revspec o path traversal).
- Longitud > 200 chars -> lanza `invalid_branch`.
- `/` sí está permitido (ramas anidadas como `feature/foo`).
- No muta la entrada más allá del trim.

## Examples
- `sanitizeBranchName('feature/foo')` -> `'feature/foo'`.
- `sanitizeBranchName('  main  ')` -> `'main'`.
- `sanitizeBranchName('feature-foo')` -> `'feature-foo'`.
- `sanitizeBranchName('..bad')` -> lanza `invalid_branch`.
- `sanitizeBranchName('a..b')` -> lanza `invalid_branch`.
- `sanitizeBranchName('-x')` -> lanza `invalid_branch`.
- `sanitizeBranchName('')` -> lanza `invalid_branch`.
- `sanitizeBranchName('feat:ure')` -> lanza `invalid_branch`.

## Do / Don't
- DO: trimar antes de validar.
- DO: permitir `/` (ramas anidadas legítimas).
- DO: rechazar `..`, `:`, `~`, `^`, opciones (`-` inicial) y path traversal.
- DON'T: ejecutar shell ni leer disco.
- DON'T: escapar el nombre; devolverlo crudo si pasa (el caller lo pasa vía execFile argv, no shell).

## Tests
Property-tests congelados en `ccdd/pr-sanitize-branch/test_sanitize_branch.js` (oráculo independiente: solo importa `PullError` del target):
- rama simple y rama anidada con `/` pasan; trim de espacios.
- `..`, `-` inicial, `:`, `~`, `^`, espacio, vacío, no-string -> todos lanzan `invalid_branch`.

## Constraints
- Budget: cyclomatic ≤ 6, nesting ≤ 2, params ≤ 1, lines ≤ 14.
- `deps_allowed: []`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si un nombre con `..` o `:` es aceptado.