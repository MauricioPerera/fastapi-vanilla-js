---
task: postal-verify-event-provenance
intent: Decidir los motivos de rechazo de provenance de un evento contra el registro de identidades
target: ../../lib/postal.js
language: javascript
signature: "async function verifyEventProvenance(ev, identities)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 2, lines_max: 12 }
deps_allowed: []
forbids: [eval]
tests: test_verify_event_provenance.js
test_command: "node --test ../ccdd/postal-verify-event-provenance/test_verify_event_provenance.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Determinar si un evento viola el gate de provenance (identidad verificable) contra el
registro de identidades del repo. Devuelve la lista de motivos (vacia = valido).

## Interface
- verifyEventProvenance(ev: event, identities: Map<agentId, publicJwk> | undefined) -> Promise<string[]>

## Invariants
- identities ausente (undefined) -> [] (modo legacy: sin gate de firma, backward-compat).
- ev.sig presente (string no vacio) + autor NO registrado -> ['unknown-author'].
- ev.sig presente + autor registrado + firma invalida -> ['bad-signature'].
- ev.sig presente + autor registrado + firma valida -> [].
- ev.sig ausente + autor registrado -> ['unsigned-registered-author'] (debe firmar).
- ev.sig ausente + autor NO registrado -> [] (anonimo legacy permitido).

## Examples
- verifyEventProvenance(evFirmadoValido, mapConAutor) -> [].
- verifyEventProvenance(evFirmadoConBodyManipulado, mapConAutor) -> ['bad-signature'].
- verifyEventProvenance(evFirmado, mapVacio) -> ['unknown-author'].
- verifyEventProvenance(evSinSig, mapConAutor) -> ['unsigned-registered-author'].
- verifyEventProvenance(ev, undefined) -> [].

## Do / Don't
- DO: delegar la verificacion cripto en verifyEventSignature.
- DON'T: lanzar; devolver motivos.
- DON'T: aplicar el gate si identities es undefined (backward-compat).

## Tests
Property-tests con claves cripto reales: registered+valido []; registered+tampered
['bad-signature']; not-registered+sig ['unknown-author']; registered+sig-null
['unsigned-registered-author']; not-registered+sig-null []; identities undefined [].

## Constraints
- Budget cyclomatic <= 5, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.