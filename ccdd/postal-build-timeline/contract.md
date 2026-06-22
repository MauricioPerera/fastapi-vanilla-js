---
task: postal-build-timeline
intent: Construir una timeline legible a partir de eventos
target: ../../lib/postal.js
language: javascript
signature: "function buildTimeline(events)"
budget: { cyclomatic_max: 4, nesting_max: 2, params_max: 1, lines_max: 12 }
deps_allowed: []
forbids: [eval]
tests: test_build_timeline.js
test_command: "node --test ../ccdd/postal-build-timeline/test_build_timeline.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Mapear cada evento a una entrada legible { seq, kind, from, at, summary } con un resumen humano por kind.

## Interface
- buildTimeline(events: event[]) -> { seq, kind, from, at, summary }[]

## Invariants
- Un entry por evento, en el mismo orden.
- summary depende del kind (issue.* / agent.message / pr.* / workflow.defined / run.* / otro).
- Conserva seq, kind, from, created_at (como at).

## Examples
- buildTimeline([{kind:"issue.created",body:{number:1,title:"t"},seq:0,from:"a",created_at:"x"}])[0].summary contiene "issue #1".
- buildTimeline([{kind:"agent.message",body:{text:"hola"},seq:0,from:"a",created_at:"x"}])[0].summary contiene "hola".
- buildTimeline([{kind:"pr.created",body:{number:2,title:"t"},seq:0,from:"a",created_at:"x"}])[0].summary contiene "PR #2".
- buildTimeline([{kind:"run.completed",body:{status:"success",exitCode:0},seq:0,from:"a",created_at:"x"}])[0].summary contiene "success".

## Do / Don't
- DO: derivar summary del kind+body.
- DON'T: mutar los eventos.

## Tests
Property-tests: un entry por evento; summaries por kind (issues, pr, workflow, run); conserva campos.

## Constraints
- Budget cyclomatic <= 4, nesting <= 2, lines <= 12.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.