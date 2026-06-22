---
task: postal-apply-rotation
intent: Aplicar un evento de rotacion de clave sobre el estado de claves de una identidad
target: ../../lib/postal.js
language: javascript
signature: "function applyRotation(keyState, ev)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 2, lines_max: 24 }
deps_allowed: []
forbids: [eval]
tests: test_apply_rotation.js
test_command: "node --test ../ccdd/postal-apply-rotation/test_apply_rotation.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Plegar un evento `identity.rotated` sobre el estado de claves de un agentId: la clave
actualmente activa queda `rotated` (con `superseded_at`) y se agrega la nueva clave como
`active`. Puro: devuelve un NUEVO keyState, no muta el input.

## Interface
- applyRotation(keyState: KeyState, ev: identityEvent) -> KeyState
- KeyState = { agentId, keys: KeyEntry[] }
- KeyEntry = { publicJwk, activated_at, status: 'active'|'rotated'|'revoked', superseded_at: null|string, revoked_at: null|string }
- ev.body = { newPublicJwk: jwk, effective_at?: isoString }; ev.created_at: isoString.

## Invariants
- La clave activa actual = la unica con status 'active' y superseded_at === null.
- effective = ev.body.effective_at || ev.created_at.
- Si NO hay clave activa (keys vacio o todas rotated/revoked) -> devuelve keyState SIN CAMBIOS (no se puede rotar sin raiz vigente).
- Clave activa previa -> { ...prev, status: 'rotated', superseded_at: effective }.
- Nueva clave -> { publicJwk: ev.body.newPublicJwk, activated_at: effective, status: 'active', superseded_at: null, revoked_at: null } agregada al final de keys.
- No muta el keyState ni el ev de entrada (devuelve estructura nueva).

## Examples
- applyRotation(stateConGenesisActiva, evRotacion) -> keys tiene 2 entradas; la genesis 'rotated' con superseded_at=effective; la nueva 'active'.
- applyRotation(stateSinActiva, evRotacion) -> igual al input (sin cambios).
- applyRotation(state, evSinEffectiveAt) -> superseded_at = ev.created_at.

## Do / Don't
- DO: resolver effective con fallback a ev.created_at.
- DO: preservar revoked_at de la clave previa al marcarla rotated.
- DON'T: mutar inputs.
- DON'T: agregar la nueva clave si no hay activa previa.

## Tests
Property-tests: rotacion marca genesis rotated + agrega nueva active; effective_at default
a created_at; sin clave activa -> sin cambios; inmutabilidad del input; nueva clave con
revoked_at null y superseded_at null.

## Constraints
- Budget cyclomatic <= 5, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.