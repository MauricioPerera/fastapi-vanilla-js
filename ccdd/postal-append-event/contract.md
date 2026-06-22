---
task: postal-append-event
intent: Persistir un evento inmutable encadenado al log del repo
target: ../../lib/postal.js
language: javascript
signature: "async function appendEvent(repoName, eventsDir, input)"
budget: { cyclomatic_max: 7, nesting_max: 2, params_max: 3, lines_max: 26 }
deps_allowed: ["./gitRepos"]
forbids: [eval]
tests: test_append_event.js
test_command: "node --test ../ccdd/postal-append-event/test_append_event.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Append un evento inmutable encadenado (seq + prev por autor, id determinista) al log del repo y devolverlo; firma ECDSA best-effort (sig null si no hay identity).

## Interface
- appendEvent(repoName, eventsDir, input: { kind, agentId, payload?, to?, identity?, created_at?, rnd? }) -> Promise<event>

## Invariants
- Primer evento del autor: seq 0, prev null.
- Siguiente del autor: seq = prev+1, prev = eventHash(evento previo).
- Cadenas independientes por autor.
- id = makeEventId(createdAt, agentId, rnd).
- Persiste en eventFilePath(repo, ev, eventsDir) (append-only: un archivo por evento).
- to se normaliza ordenado; sig null sin identity.
- Valida input via validateEventInput (invalid_input).

## Examples
- appendEvent("r", dir, {kind:"agent.message",agentId:"a",payload:{text:"x"}}) -> event.seq === 0, event.prev === null.
- segundo append del mismo autor -> event.seq === 1, event.prev === eventHash del primero.

## Do / Don't
- DO: encadenar con readChainTip.
- DON'T: sobrescribir archivos existentes (append-only).

## Tests
Property-tests: primer evento seq 0 prev null; segundo encadena; independencia por autor; to ordenado; invalid_input lanza; persiste archivo.

## Constraints
- Budget cyclomatic <= 7, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.