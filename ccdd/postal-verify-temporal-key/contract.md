---
task: postal-verify-temporal-key
intent: Decidir los motivos de invalidez temporal de una clave firmante en un instante
target: ../../lib/postal.js
language: javascript
signature: "function verifyTemporalKey(keyEntry, timestamp)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 2, lines_max: 14 }
deps_allowed: []
forbids: [eval]
tests: test_verify_temporal_key.js
test_command: "node --test ../ccdd/postal-verify-temporal-key/test_verify_temporal_key.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Dado una entrada de clave y un instante `timestamp` (created_at de un evento firmado por
esa clave), devolver los motivos de invalidez temporal. Vacia = la clave era valida
(vigente y no revocada) en ese instante. Puro.

## Interface
- verifyTemporalKey(keyEntry: KeyEntry, timestamp: isoString) -> string[]
- KeyEntry = { publicJwk, activated_at, status, superseded_at: null|string, revoked_at: null|string }

## Invariants
- Si keyEntry.revoked_at != null Y timestamp > keyEntry.revoked_at -> ['revoked-key'].
- Si keyEntry.superseded_at != null Y timestamp > keyEntry.superseded_at -> ['stale-key'].
- Si timestamp < keyEntry.activated_at -> ['future-key'].
- En otro caso -> [].
- Precedencia: revoked-key > stale-key > future-key (devolver el primero que aplique, uno solo).
- Comparacion estricta `>` para revoked/stale: el instante propio del evento de revocacion/rotacion (t == revoked_at / t == superseded_at) NO se rechaza.
- No muta inputs.

## Examples
- verifyTemporalKey(claveRevocada, tPosteriorARevocacion) -> ['revoked-key'].
- verifyTemporalKey(claveRevocada, t == revoked_at) -> [].
- verifyTemporalKey(claveRotada, tPosteriorARotacion) -> ['stale-key'].
- verifyTemporalKey(claveActiva, tEnVentana) -> [].
- verifyTemporalKey(claveRevocadaYRotada, tPosteriorAmbos) -> ['revoked-key'].

## Do / Don't
- DO: usar `>` estricto para revoked y stale.
- DO: devolver un solo motivo (el de mayor precedencia).
- DON'T: mutar inputs.
- DON'T: rechazar en el borde (t == *_at).

## Tests
Property-tests: revocada t>revoked_at -> revoked-key; revocada t==revoked_at -> [];
rotada t>superseded_at -> stale-key; rotada t==superseded_at -> []; t<activated_at ->
future-key; activa en ventana -> []; revocada+rotada t>ambos -> revoked-key.

## Constraints
- Budget cyclomatic <= 5, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.