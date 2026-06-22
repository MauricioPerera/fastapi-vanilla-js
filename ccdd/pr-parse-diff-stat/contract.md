---
task: pr-parse-diff-stat
intent: Parsear la salida de git diff --numstat a un resumen de diff
target: ../../lib/pulls.js
language: javascript
signature: "function parseDiffStatOutput(stdout)"
budget: { cyclomatic_max: 8, nesting_max: 2, params_max: 1, lines_max: 36 }
deps_allowed: []
forbids: [eval, exec]
tests: test_parse_diff_stat.js
test_command: "node --test ../ccdd/pr-parse-diff-stat/test_parse_diff_stat.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Parsear la salida de `git diff --numstat base...head` a un resumen `{files, totalAdditions, totalDeletions, filesChanged}`, donde cada archivo es `{file, additions, deletions}` y los binarios (`-`) cuentan como 0.

## Interface
- `parseDiffStatOutput(stdout: string) -> { files: Array<{file, additions, deletions}>, totalAdditions: number, totalDeletions: number, filesChanged: number }`
- Sin lanza.

## Invariants
- Salida vacía -> `{ files: [], totalAdditions: 0, totalDeletions: 0, filesChanged: 0 }`.
- Cada línea: `additions<TAB>deletions<TAB>path`. `additions`/`deletions` = Number; `-` (binario) -> 0.
- `totalAdditions` = suma de additions; `totalDeletions` = suma de deletions; `filesChanged` = `files.length`.
- Líneas vacías o con < 3 campos se descartan.
- No muta la entrada.

## Examples
- `parseDiffStatOutput('')` -> `{files:[], totalAdditions:0, totalDeletions:0, filesChanged:0}`.
- `parseDiffStatOutput('5\t2\tfile1.js\n')` -> `{files:[{file:'file1.js', additions:5, deletions:2}], totalAdditions:5, totalDeletions:2, filesChanged:1}`.
- `parseDiffStatOutput('5\t2\ta.js\n12\t0\tb.js\n')` -> totalAdditions 17, totalDeletions 2, filesChanged 2.
- `parseDiffStatOutput('-\t-\tbinary.bin\n')` -> additions 0, deletions 0, file 'binary.bin'.

## Do / Don't
- DO: usar Number() para parsear; `-` -> 0.
- DO: sumar totales.
- DON'T: lanzar.
- DON'T: incluir líneas con < 3 campos.

## Tests
Property-tests congelados en `ccdd/pr-parse-diff-stat/test_parse_diff_stat.js` (oráculo independiente):
- vacío; un archivo; varios archivos con totales; archivo binario con `-`; línea malformada se omite.

## Constraints
- Budget: cyclomatic ≤ 8, nesting ≤ 2, params ≤ 1, lines ≤ 36.
- `deps_allowed: []`; `forbids: [eval, exec]`.
- PARAR y reportar si el gate excede el budget o si un binario (`-`) suma distinto de 0.