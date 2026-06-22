---
task: postal-resolve-active-key-at
intent: Resolver la clave vigente de una identidad en un instante de tiempo
target: ../../lib/postal.js
language: javascript
signature: "function resolveActiveKeyAt(keyState, timestamp)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 2, lines_max: 20 }
deps_allowed: []
forbids: [eval]
tests: test_resolve_active_key_at.js
test_command: "node --test ../ccdd/postal-resolve-active-key-at/test_resolve_active_key_at.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Dado el estado de claves de una identidad y un instante `timestamp` (ISO 8601 UTC),
devolver la entrada de clave que estaba VIGENTE (activa y no revocada ni superseded) en
ese instante. Puro. Devuelve null si ninguna clave cubre el instante.

## Interface
- resolveActiveKeyAt(keyState: KeyState, timestamp: isoString) -> KeyEntry | null
- KeyEntry = { publicJwk, activated_at, status, superseded_at: null|string, revoked_at: null|string }

## Invariants
- Una clave cubre el instante t si: activated_at <= t Y (superseded_at === null O t <= superseded_at) Y (revoked_at === null O t <= revoked_at).
- timestamp y los *_at son strings ISO 8601 UTC (orden lexicografico == orden cronologico).
- Si varias cubren t (ventanas solapadas en el borde), devolver la de activated_at mas reciente (mayor) que sea <= t.
- Si ninguna cubre t -> null.
- No muta inputs.

## Examples
- resolveActiveKeyAt(stateConGenesis, tAntesDeRotacion) -> genesis.
- resolveActiveKeyAt(stateRotada, tDespuesDeRotacion) -> la nueva clave.
- resolveActiveKeyAt(stateRevocada, tPosteriorARevocacion) -> null.
- resolveActiveKeyAt(stateRotada, tExactamenteEnSuperseded) -> la nueva (t <= superseded_at de la vieja y t >= activated_at de la nueva).

## Do / Don't
- DO: comparar timestamps como strings (ISO UTC).
- DO: usar <= (inclusive) en los bordes de ventana.
- DON'T: mutar inputs.
- DON'T: devolver una clave revocada para t >= revoked_at.

## Tests
Property-tests: genesis vigente antes de rotacion; nueva vigente despues de rotacion;
revocada -> null para t posterior; borde de superseded_at (t == superseded_at) cae del
lado de la nueva; sin claves -> null.

## Constraints
- Budget cyclomatic <= 6, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.