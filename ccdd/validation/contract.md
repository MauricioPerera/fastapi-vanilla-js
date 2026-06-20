---
task: validate-value-against-schema
intent: Validar un valor contra un esquema declarativo recursivo
target: ../../lib/validation.js
language: javascript
signature: "function validate(value, schema, path)"
budget: { cyclomatic_max: 10, nesting_max: 3, params_max: 4, lines_max: 45 }
deps_allowed: []
forbids: [eval, exec]
tests: test_validate.js
test_command: "node --test ccdd/validation/test_validate.js"
spec_version: "0.1"
require_test_approval: false
---
Contrato verificado con el gate determinista CCDD (run_task_gate -> PASS:
cyclomatic 6, nesting 1, params 3, lines 15). Ver lib/validation.js (validate)
y los property-tests congelados en test_validate.js.
