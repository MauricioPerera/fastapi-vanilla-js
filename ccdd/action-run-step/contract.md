---
task: action-run-step
intent: Ejecutar un step de shell en el cwd indicado
target: ../../lib/actions.js
language: javascript
signature: "function runStep(step, cwd)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 2, lines_max: 14 }
deps_allowed: []
forbids: [eval]
tests: test_run_step.js
test_command: "node --test ../ccdd/action-run-step/test_run_step.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Ejecutar un step (comando de shell) en el `cwd` indicado y devolver `{ name, command, status, stdout, stderr, exitCode }`.

## Interface
- `runStep(step: string | { command, name? }, cwd: string) -> Promise<result>`
- `result = { name, command, status: 'success'|'failure', stdout, stderr, exitCode }`.
- Un step string `"cmd"` se normaliza a `{ name: 'cmd', command: 'cmd' }`.
- Step inválido (command no-string) -> `status: 'failure'`, `exitCode: 1`, `stderr: 'step inválido'` (sin lanzar).

## Invariants
- `status === 'success'` sii el proceso termina con código 0.
- `status === 'failure'` y `exitCode` = código de error (o 1 si no es numérico) cuando el proceso falla.
- `stdout`/`stderr` siempre son strings.
- `cwd` se respeta (el proceso corre en ese directorio).

## Examples
- `runStep('echo hi', <tmp>)` -> `status: 'success'`, `exitCode: 0`, `stdout` contiene `'hi'`.
- `runStep` con comando que sale con código 3 -> `status: 'failure'`, `exitCode: 3`.
- `runStep({ command: 5 }, <tmp>)` -> `status: 'failure'` (step inválido, sin lanzar).

## Do / Don't
- DO: ejecutar via shell (child_process.exec) — el step es shell arbitrario por diseño.
- DO: devolver siempre un resultado, nunca lanzar por un step inválido.
- DON'T: sanitizar el comando del step (es shell arbitrario intencional).

## Tests
Property-tests congelados en `ccdd/action-run-step/test_run_step.js` (oráculo independiente: usa scripts node temporales y verifica cwd/salida/código):
- Step exitoso: `status: 'success'`, `exitCode: 0`, stdout con la salida esperada.
- Step fallido (exit 3): `status: 'failure'`, `exitCode: 3`.
- `cwd` se respeta (el proceso corre en el tmpdir).
- Step inválido -> `status: 'failure'` sin lanzar.

## Constraints
- Budget: cyclomatic ≤ 6, nesting ≤ 2, params ≤ 2, lines ≤ 14.
- `deps_allowed: []` (builtins: child_process); `forbids: [eval]` (shell via exec es permitido y necesario).
- PARAR y reportar si el gate excede el budget o si runStep lanza en lugar de devolver un resultado.