---
task: postal-list-events
intent: Listar los eventos de un repo con filtros opcionales
target: ../../lib/postal.js
language: javascript
signature: "async function listEvents(repoName, eventsDir, filters)"
budget: { cyclomatic_max: 8, nesting_max: 2, params_max: 3, lines_max: 15 }
deps_allowed: ["./gitRepos"]
forbids: [eval]
tests: test_list_events.js
test_command: "node --test ../ccdd/postal-list-events/test_list_events.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Devolver los eventos del repo ordenados por (created_at, id), opcionalmente filtrados por kind/from/since.

## Interface
- listEvents(repoName, eventsDir, filters?: { kind?, from?, since? }) -> Promise<event[]>

## Invariants
- Repo sin eventos -> [].
- Orden: created_at ascendente, desempate por id.
- filters.kind filtra por kind exacto; from por autor; since por created_at >= since.
- Sanitiza repoName.
- No muta disco.

## Examples
- listEvents(repoVacio, dir) -> [].
- listEvents(r, dir, { kind: "agent.message" }) devuelve solo los de ese kind.

## Do / Don't
- DO: ordenar por created_at luego id.
- DON'T: depender del orden de lectura del filesystem.

## Tests
Property-tests: vacio []; orden por created_at; filtro kind; filtro from; filtro since.

## Constraints
- Budget cyclomatic <= 8, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.