---
task: pr-diff-stat
intent: Devolver el diff resumido de un pull request en el rango base...head
target: ../../lib/pulls.js
language: javascript
signature: "async function getPrDiffStat(repoPath, head, base)"
budget: { cyclomatic_max: 3, nesting_max: 1, params_max: 3, lines_max: 16 }
deps_allowed: []
forbids: [eval]
tests: test_pr_diff_stat.js
test_command: "node --test ../ccdd/pr-diff-stat/test_pr_diff_stat.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Devolver el diff resumido entre `base` y `head` (`git diff --numstat base...head`) parseado a `{files, totalAdditions, totalDeletions, filesChanged}`. Se usa `--numstat` (forma estructurada y determinista de `--stat`, mismo rango `base...head`) para evitar el parseo frágil de la barra `+`/`-`.

## Interface
- `getPrDiffStat(repoPath, head: string, base: string) -> Promise<{files, totalAdditions, totalDeletions, filesChanged}>`
- Lanza `PullError('invalid_branch')` si `head`/`base` son inválidos.
- Sin cambios en el rango -> `{files:[], totalAdditions:0, totalDeletions:0, filesChanged:0}`.

## Invariants
- Ejecuta `git diff --numstat <base>...<head>` en `repoPath` y parsea con `parseDiffStatOutput`.
- El rango se pasa como un solo argv `<base>...<head>` (con nombres sanitizados).

## Examples
- `feat` añade 1 archivo nuevo sobre `main`; `getPrDiffStat(repo,'feat','main')` -> `filesChanged >= 1`, `totalAdditions > 0`.
- `head === base` -> resumen cero.
- `getPrDiffStat(repo,'a..b','main')` -> lanza `invalid_branch`.

## Do / Don't
- DO: sanitizar `head` y `base` antes de construir el rango.
- DO: delegar el parseo en `parseDiffStatOutput`.
- DON'T: ejecutar shell ni parsear la barra de `--stat`.

## Tests
Property-tests congelados en `ccdd/pr-diff-stat/test_pr_diff_stat.js` (oráculo independiente: repo bare real; verifica con git directo):
- feat añade archivo -> filesChanged>=1 y totalAdditions>0; head===base -> cero; rama con `..` -> invalid_branch.

## Constraints
- Budget: cyclomatic ≤ 3, nesting ≤ 1, params ≤ 3, lines ≤ 16.
- `deps_allowed: []`; `forbids: [eval]`.
- PARAR y reportar si el gate excede el budget o si head===base devuelve cambios.