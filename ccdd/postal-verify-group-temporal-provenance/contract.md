---
task: postal-verify-group-temporal-provenance
intent: Reportar los fallos de provenance temporal de todos los eventos de un autor
target: ../../lib/postal.js
language: javascript
signature: "async function verifyGroupTemporalProvenance(from, list, keyLedger)"
budget: { cyclomatic_max: 4, nesting_max: 2, params_max: 3, lines_max: 12 }
deps_allowed: []
forbids: [eval]
tests: test_verify_group_temporal_provenance.js
test_command: "node --test ../ccdd/postal-verify-group-temporal-provenance/test_verify_group_temporal_provenance.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Reportar los fallos de provenance temporal de cada evento de un autor contra el ledger de
claves, delegando en verifyTemporalProvenance por evento.

## Interface
- verifyGroupTemporalProvenance(from: agentId, list: event[], keyLedger: Map<agentId, KeyState>) -> Promise<{ from, seq, reasons[] }[]>

## Invariants
- Funcion disponible en el modulo (USARLA): verifyTemporalProvenance(ev, keyLedger) -> Promise<string[]>.
- Algoritmo:
  1. failures = [].
  2. for ev of list: reasons = await verifyTemporalProvenance(ev, keyLedger); si reasons.length -> failures.push({ from, seq: ev.seq, reasons }).
  3. return failures.
- No muta inputs.

## Examples
- verifyGroupTemporalProvenance('a', [evValido], ledger) -> [].
- verifyGroupTemporalProvenance('a', [evStale], ledger) -> [{ from:'a', seq, reasons:['stale-key'] }].
- verifyGroupTemporalProvenance('a', [], ledger) -> [].

## Do / Don't
- DO: delegar por evento en verifyTemporalProvenance.
- DON'T: re-implementar la verificacion temporal.

## Tests
Property-tests con cripto real: evento activo en ventana -> sin fallos; evento con clave
rotada y t>superseded_at -> stale-key; evento con clave revocada y t>revoked_at ->
revoked-key; lista vacia -> [].

## Constraints
- Budget cyclomatic <= 4, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.