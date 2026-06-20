---
task: coerce-value-to-schema-types
intent: Coercionar un valor a los tipos declarados por el esquema
target: ../../lib/validation.js
language: javascript
signature: "function coerce(value, schema)"
budget: { cyclomatic_max: 10, nesting_max: 3, params_max: 3, lines_max: 35 }
deps_allowed: []
forbids: [eval, exec]
tests: test_coerce.js
test_command: "node --test ccdd/coerce/test_coerce.js"
spec_version: "0.1"
require_test_approval: false
---
Contrato verificado con el gate determinista CCDD (run_task_gate -> PASS:
cyclomatic 10, nesting 3, params 2, lines 15). Ver lib/validation.js (coerce)
y los property-tests congelados en test_coerce.js.
