---
task: serialize-value-by-response-model
intent: Filtrar un valor dejando solo los campos declarados por el esquema
target: ../../lib/validation.js
language: javascript
signature: "function serialize(value, schema)"
budget: { cyclomatic_max: 10, nesting_max: 3, params_max: 3, lines_max: 30 }
deps_allowed: []
forbids: [eval, exec]
tests: test_serialize.js
test_command: "node --test ccdd/serialize/test_serialize.js"
spec_version: "0.1"
require_test_approval: false
---
Contrato verificado con el gate determinista CCDD (run_task_gate -> PASS:
cyclomatic 9, nesting 3, params 2, lines 15). Ver lib/validation.js (serialize)
y los property-tests congelados en test_serialize.js.
