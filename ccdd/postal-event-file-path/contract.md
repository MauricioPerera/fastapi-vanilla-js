---
task: postal-event-file-path
intent: Construir el path determinista del archivo de evento
target: ../../lib/postal.js
language: javascript
signature: "function eventFilePath(repoName, ev, eventsDir)"
budget: { cyclomatic_max: 4, nesting_max: 2, params_max: 3, lines_max: 9 }
deps_allowed: ["./gitRepos"]
forbids: [eval]
tests: test_event_file_path.js
test_command: "node --test ../ccdd/postal-event-file-path/test_event_file_path.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Devolver el path determinista del archivo de evento: <eventsDir>/<repo>/<YYYY>/<MM>/<DD>/<id>.json, sanitizando el nombre de repo.

## Interface
- eventFilePath(repoName, ev, eventsDir) -> string

## Invariants
- Sanitiza repoName via sanitizeRepoName (lanza RepoError invalid_name si es invalido).
- Usa componentes UTC de ev.created_at (YYYY/MM/DD).
- Termina en <repo>/<YYYY>/<MM>/<DD>/<id>.json.

## Examples
- eventFilePath("r",{created_at:"2026-03-04T05:06Z",id:"id1"},"/d") termina en "r/2026/03/04/id1.json".
- eventFilePath("../bad", {created_at:"2026-01-01T00:00Z",id:"x"},"/d") lanza invalid_name.

## Do / Don't
- DO: reusar sanitizeRepoName.
- DON'T: aceptar path traversal en repoName.

## Tests
Property-tests: path con componentes UTC, sanitizacion invalid_name, id al final.

## Constraints
- Budget cyclomatic <= 4, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.