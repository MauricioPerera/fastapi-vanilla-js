---
task: postal-fold-identity-events
intent: Plegar los eventos de identidad de un agente en su estado de claves auto-certificante
target: ../../lib/postal.js
language: javascript
signature: "async function foldIdentityEvents(genesisEntry, events)"
budget: { cyclomatic_max: 8, nesting_max: 3, params_max: 2, lines_max: 30 }
deps_allowed: []
forbids: [eval]
tests: test_fold_identity_events.js
test_command: "node --test ../ccdd/postal-fold-identity-events/test_fold_identity_events.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Construir el KeyState de un agentId plegando sus eventos de identidad (`identity.rotated` /
`identity.revoked`) en orden cronologico, partiendo de la clave genesis. Auto-certificante:
cada evento debe estar firmado por la clave actualmente activa; al primer evento con firma
invalida se DETIENE el plegado (la cadena de supersedencia esta rota a partir de ahi).

## Interface
- foldIdentityEvents(genesisEntry: { agentId, publicJwk, activated_at }, events: identityEvent[]) -> Promise<KeyState>
- KeyState = { agentId, keys: KeyEntry[] }

## Invariants
- Funciones disponibles en el mismo modulo (USARLAS, no re-implementar): verifyEventSignature(ev, publicJwk) -> Promise<bool>, applyRotation(state, ev) -> state, applyRevocation(state, ev) -> state.
- Algoritmo:
  1. state = { agentId: genesisEntry.agentId, keys: [ { publicJwk: genesisEntry.publicJwk, activated_at: genesisEntry.activated_at, status: 'active', superseded_at: null, revoked_at: null } ] }.
  2. sorted = events.slice().sort((a,b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0).
  3. for ev of sorted:
     a. active = state.keys.find(k => k.status === 'active' && k.superseded_at === null).
     b. si !active -> break.
     c. si ev.kind === 'identity.rotated': si await verifyEventSignature(ev, active.publicJwk) === true -> state = applyRotation(state, ev); SINO break.
     d. sino si ev.kind === 'identity.revoked': si await verifyEventSignature(ev, active.publicJwk) === true -> state = applyRevocation(state, ev); SINO break.
     e. sino (otro kind): continue.
  4. return state.
- No muta inputs (events ni genesisEntry); usar .slice() antes de sort.
- El estado inicial ya tiene la genesis active; events vacio -> devuelve el inicial.

## Examples
- foldIdentityEvents(genesis, []) -> state con solo la genesis active.
- foldIdentityEvents(genesis, [rotacionFirmadaPorGenesis]) -> genesis 'rotated' + nueva 'active'.
- foldIdentityEvents(genesis, [rotacionFirmadaPorClaveEquivocada]) -> solo genesis (break, sin aplicar).
- foldIdentityEvents(genesis, [rotacion, revocacionFirmadaPorNueva]) -> nueva clave 'revoked'.

## Do / Don't
- DO: usar verifyEventSignature, applyRotation y applyRevocation del mismo modulo.
- DO: ordenar con .slice().sort(...) por created_at.
- DON'T: aplicar un evento cuya firma no verifique contra la activa (break).
- DON'T: re-implementar la rotacion/revocacion/firma (delegar).
- DON'T: mutar inputs.

## Tests
Property-tests con cripto real: genesis sola; rotacion firmada por genesis aplica; rotacion
firmada por clave equivocada -> break (solo genesis); rotacion + revocacion firmada por la
nueva activa -> nueva revoked; effective_at default a created_at en la rotacion aplicada.

## Constraints
- Budget cyclomatic <= 8, nesting <= 3.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.