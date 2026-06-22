---
task: postal-apply-revocation
intent: Aplicar un evento de revocacion de clave sobre el estado de claves de una identidad
target: ../../lib/postal.js
language: javascript
signature: "function applyRevocation(keyState, ev)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 2, lines_max: 24 }
deps_allowed: []
forbids: [eval]
tests: test_apply_revocation.js
test_command: "node --test ../ccdd/postal-apply-revocation/test_apply_revocation.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Plegar un evento `identity.revoked` sobre el estado de claves de un agentId: marca una
clave como `revoked` con `revoked_at`. Puro: devuelve un NUEVO keyState, no muta el input.

## Interface
- applyRevocation(keyState: KeyState, ev: identityEvent) -> KeyState
- KeyEntry = { publicJwk, activated_at, status, superseded_at, revoked_at }
- ev.body = { targetPublicJwk?: jwk, revoked_at?: isoString }; ev.created_at: isoString.

## Invariants
- keyState = { agentId, keys: KeyEntry[] }. El ARREGLO de claves es keyState.keys (NUNCA keyState mismo).
- revokedAt = ev.body.revoked_at || ev.created_at.
- target: si ev.body.targetPublicJwk esta presente -> la entrada dentro de keyState.keys cuyo publicJwk es canonicamente igual (canonical(k.publicJwk) === canonical(targetPublicJwk)); si ausente -> la entrada activa actual (status 'active' && superseded_at === null) dentro de keyState.keys.
- Si no se encuentra target -> devuelve keyState SIN CAMBIOS (la misma referencia).
- Si el target ya tiene revoked_at != null -> devuelve keyState SIN CAMBIOS (idempotente).
- target -> { ...target, status: 'revoked', revoked_at: revokedAt }; las demas entradas intactas.
- No muta keyState ni ev; devuelve { agentId, keys: [...] } nuevo.

## Examples
- applyRevocation(stateConActiva, evSinTarget) -> la activa pasa a revoked con revoked_at.
- applyRevocation(state, evConTarget) -> solo la clave matching target se revoca.
- applyRevocation(stateYaRevocada, ev) -> sin cambios (idempotente).
- applyRevocation(stateSinTarget, evConTargetInexistente) -> sin cambios.

## Do / Don't
- DO: comparar publicJwk con canonical() (deep-equal estable).
- DO: resolver revokedAt con fallback a ev.created_at.
- DON'T: mutar inputs.
- DON'T: revocar dos veces (idempotente).

## Tests
Property-tests: revoca activa sin target; revoked_at default a created_at; revoca target
especifico; idempotente; target inexistente -> sin cambios; inmutabilidad.

## Constraints
- Budget cyclomatic <= 6, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.