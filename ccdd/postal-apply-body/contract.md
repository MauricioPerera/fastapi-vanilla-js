---
task: postal-apply-body
intent: Aplicar el body de un evento sobre el estado
target: ../../lib/postal.js
language: javascript
signature: "function applyBody(next, ev)"
budget: { cyclomatic_max: 3, nesting_max: 1, params_max: 2, lines_max: 6 }
deps_allowed: []
forbids: [eval]
tests: test_apply_body.js
test_command: "node --test ../ccdd/postal-apply-body/test_apply_body.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Aplicar el body de un evento sobre el estado (muta next in-place) segun el kind; kind desconocido es no-op.

## Interface
- applyBody(next: state, ev: event) -> state (la misma ref, mutada)

## Invariants
- issue.created con number crea la entrada en issues.
- issue.state_changed actualiza el estado de un issue existente.
- issue.commented incrementa comentarios de un issue existente.
- agent.message agrega un mensaje.
- pr.created con number crea la entrada en pulls (con mergeCommitSha null).
- pr.state_changed actualiza el estado de un PR existente.
- pr.commented incrementa comentarios de un PR existente.
- pr.merged marca un PR existente como merged y guarda mergeCommitSha.
- workflow.defined con name crea la entrada en workflows.
- run.started con runId crea la entrada en runs con status running.
- run.completed con runId actualiza status y exitCode de un run.
- Kind desconocido: no-op (next sin cambios).
- Devuelve la misma referencia next.

## Examples
- applyBody({issues:{},pulls:{},workflows:{},runs:{},messages:[],counts:{}}, {kind:"issue.created",body:{number:1,title:"t"}}) -> issues["1"] definido.
- applyBody(s, {kind:"pr.created",body:{number:1,title:"t",head:"f",base:"m"}}) -> pulls["1"] definido con mergeCommitSha null.
- applyBody(s, {kind:"run.started",body:{runId:"r1",workflow:"w",event:"manual"}}) -> runs["r1"].status === "running".
- applyBody(s, {kind:"unknown"}) -> s sin cambios.

## Do / Don't
- DO: despachar por kind via la tabla BODY_APPLIERS.
- DON'T: contar (eso es de foldEvent).

## Tests
Property-tests: issue.created crea; state_changed actualiza; agent.message agrega; pr.created/merged; workflow.defined; run.started/completed; unknown no-op; devuelve misma ref.

## Constraints
- Budget cyclomatic <= 3, nesting <= 1.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.