---
task: postal-verify-temporal-provenance
intent: Verificar la provenance temporal de un evento contra el ledger de claves
target: ../../lib/postal.js
language: javascript
signature: "async function verifyTemporalProvenance(ev, keyLedger)"
budget: { cyclomatic_max: 7, nesting_max: 2, params_max: 2, lines_max: 22 }
deps_allowed: []
forbids: [eval]
tests: test_verify_temporal_provenance.js
test_command: "node --test ../ccdd/postal-verify-temporal-provenance/test_verify_temporal_provenance.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Determinar los motivos de rechazo temporal de un evento contra el ledger de estados de
claves. Devuelve [] si el evento es admisible: la firma verifica contra alguna clave del
autor Y esa clave estaba activa en ev.created_at.

## Interface
- verifyTemporalProvenance(ev: event, keyLedger: Map<agentId, KeyState>) -> Promise<string[]>

## Invariants
- Funciones disponibles en el modulo (USARLAS, no re-implementar): verifyEventSignature(ev, publicJwk) -> Promise<bool>, verifyTemporalKey(keyEntry, createdAt) -> string[], hasSig(ev) -> bool.
- Algoritmo:
  1. si !keyLedger -> return [] (legacy: sin registro, solo cadena).
  2. keyState = keyLedger.get(ev.from); si !keyState -> return hasSig(ev) ? ['unknown-author'] : [] (anonimo-legacy: autor no registrado SIN firma se admite, compat iter 3 provenance).
  3. si !hasSig(ev) -> return ['unsigned-registered-author'].
  4. signer = null; for k of keyState.keys: si await verifyEventSignature(ev, k.publicJwk) === true -> signer = k; break.
  5. si !signer -> return ['bad-signature'].
  6. return verifyTemporalKey(signer, ev.created_at).
- No muta inputs.
- El break en el paso 4 es apenas se halla el primer firmante valido.

## Examples
- verifyTemporalProvenance(ev, null) -> [].
- verifyTemporalProvenance(evSinFirmaDeAutorNoRegistrado, ledger) -> [] (anonimo-legacy admitido).
- verifyTemporalProvenance(evSinFirma, ledgerConAutor) -> ['unsigned-registered-author'].
- verifyTemporalProvenance(evFirmadoDeAutorNoRegistrado, ledger) -> ['unknown-author'].
- verifyTemporalProvenance(evFirmaInvalida, ledger) -> ['bad-signature'].
- verifyTemporalProvenance(evFirmadoPorClaveActiva, ledger) -> [].
- verifyTemporalProvenance(evFirmadoPorClaveRotada_tDespues, ledger) -> ['stale-key'].
- verifyTemporalProvenance(evFirmadoPorClaveRevocada_tDespues, ledger) -> ['revoked-key'].

## Do / Don't
- DO: delegar firma en verifyEventSignature, ventana temporal en verifyTemporalKey, firma-presente en hasSig.
- DO: cortar al primer firmante valido.
- DON'T: re-implementar firma ni ventana temporal.
- DON'T: mutar inputs.
- DON'T: marcar unknown-author a un evento SIN firma de autor no registrado (anonimo-legacy se admite).

## Tests
Property-tests con cripto real: sin ledger -> []; autor no registrado SIN firma -> []
(anonimo-legacy, ledger presente); autor no registrado CON firma -> unknown-author;
sin firma registrado -> unsigned-registered-author; firma invalida -> bad-signature;
clave activa en ventana -> []; clave rotada y t>superseded_at -> stale-key; clave
revocada y t>revoked_at -> revoked-key; clave vieja firmada ANTES de la rotacion -> [];
clave nueva firmada DESPUES de la rotacion -> [].

## Constraints
- Budget cyclomatic <= 7, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.