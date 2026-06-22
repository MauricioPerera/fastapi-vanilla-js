---
task: postal-read-chain-tip
intent: Calcular el tip de la cadena de un autor en un repo
target: ../../lib/postal.js
language: javascript
signature: "async function readChainTip(repoName, eventsDir, agentId)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 3, lines_max: 13 }
deps_allowed: ["./gitRepos"]
forbids: [eval]
tests: test_read_chain_tip.js
test_command: "node --test ../ccdd/postal-read-chain-tip/test_read_chain_tip.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Devolver { seq, prev } para el proximo evento del autor: seq = mayor seq existente + 1 (0 si no tiene eventos); prev = hash del ultimo evento (null si es el primero).

## Interface
- readChainTip(repoName, eventsDir, agentId) -> Promise<{ seq: number, prev: string|null }>

## Invariants
- Repo vacio o autor sin eventos -> { seq: 0, prev: null }.
NaN
- seq = (mayor seq del autor) + 1.
- prev = eventHash del ultimo evento del autor.
- Independiente por autor (los eventos de otros no afectan el tip de este).

## Examples
- readChainTip(repoVacio, dir, "alice") -> { seq: 0, prev: null }.
- tras un evento de alice, readChainTip -> { seq: 1, prev: <hash> }.

## Do / Don't
- DO: filtrar eventos por from === agentId.
- DON'T: mezclar cadepor distintos autores.

## Tests
Property-tests: vacio -> seq 0 prev null; un evento -> seq 1 prev hash; independencia entre autores.

## Constraints
- Budget cyclomatic <= 6, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.