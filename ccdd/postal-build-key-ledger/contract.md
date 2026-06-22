---
task: postal-build-key-ledger
intent: Construir el ledger de estados de claves por identidad plegando eventos via foldIdentityEvents
target: ../../lib/postal.js
language: javascript
signature: "async function buildKeyLedger(identities, identityEvents)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 2, lines_max: 18 }
deps_allowed: []
forbids: [eval]
tests: test_build_key_ledger.js
test_command: "node --test ../ccdd/postal-build-key-ledger/test_build_key_ledger.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Construir un Map<agentId, KeyState> iterando las identidades registradas (genesis) y
plegando los eventos de identidad de cada agente via foldIdentityEvents. Eventos de
agentes sin genesis registrada se ignoran (seran unknown-author en verificacion).

## Interface
- buildKeyLedger(identities: Map<agentId, genesisEntry>, identityEvents: identityEvent[]) -> Promise<Map<agentId, KeyState>>
- genesisEntry = { agentId, publicJwk, activated_at }

## Invariants
- Funcion disponible en el modulo (USARLA): foldIdentityEvents(genesisEntry, events) -> Promise<KeyState>.
- Algoritmo:
  1. ledger = new Map().
  2. grouped = Map agentId -> event[]; agrupar identityEvents por ev.from.
  3. for [agentId, genesisEntry] of identities: events = grouped.get(agentId) || []; state = await foldIdentityEvents(genesisEntry, events); ledger.set(agentId, state).
  4. return ledger.
- No muta inputs.
- identities vacio -> Map vacio.

## Examples
- buildKeyLedger(mapConUnaGenesis, []) -> Map con esa agentId -> KeyState solo genesis.
- buildKeyLedger(mapConGenesis, [rotacionFirmadaPorGenesis]) -> esa agentId -> 2 claves.
- buildKeyLedger(map, [eventoDeAgenteNoRegistrado]) -> el agente no registrado no aparece.
- buildKeyLedger(mapVacio, eventos) -> Map vacio.

## Do / Don't
- DO: delegar el plegado por agente en foldIdentityEvents.
- DO: agrupar identityEvents por from.
- DON'T: incluir agentes sin genesis.
- DON'T: mutar inputs.

## Tests
Property-tests con cripto real: genesis sola -> 1 clave; genesis + rotacion -> 2 claves;
agente no registrado ignorado; dos agentes cada uno con su estado.

## Constraints
- Budget cyclomatic <= 5, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.