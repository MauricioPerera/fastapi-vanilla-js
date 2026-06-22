---
task: postal-verify-event-signature
intent: Verificar la firma ECDSA P-256 de un evento contra la clave publica del autor
target: ../../lib/postal.js
language: javascript
signature: "async function verifyEventSignature(ev, publicJwk)"
budget: { cyclomatic_max: 4, nesting_max: 2, params_max: 2, lines_max: 12 }
deps_allowed: []
forbids: [eval]
tests: test_verify_event_signature.js
test_command: "node --test ../ccdd/postal-verify-event-signature/test_verify_event_signature.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Verificar que ev.sig es una firma ECDSA P-256 valida sobre canonical(signedView(ev))
producida por la clave privada correspondiente a publicJwk.

## Interface
- verifyEventSignature(ev: event, publicJwk: JsonWebKey) -> Promise<boolean>

## Invariants
- Firma sobre canonical(signedView(ev)) = canonical del evento sin el campo `sig`.
- ev.sig esta en hex; se decodifica a bytes antes de verificar.
- Retorna false (no lanza) si: no hay crypto, sig ausente/vacio, publicJwk ausente,
  sig malformada, o la firma no verifica (incluye body manipulado y clave distinta).
- Retorna true solo si subtle.verify confirma la firma.

## Examples
- verifyEventSignature(eventoFirmado, pubJwkCorrecta) -> true.
- verifyEventSignature(eventoFirmadoConBodyManipulado, pubJwkCorrecta) -> false.
- verifyEventSignature(eventoFirmado, pubJwkDeOtraClave) -> false.
- verifyEventSignature({sig:null,...}, pubJwk) -> false.

## Do / Don't
- DO: usar canonical(signedView(ev)) como bytes firmados y SHA-256 como hash.
- DON'T: lanzar excepciones; toda via erronea retorna false.
- DON'T: incluir el campo `sig` dentro de lo firmado/verificado.

## Tests
Property-tests con vectores cripto reales: oraculo independiente que firma con subtle.sign
directo sobre canonical(signedView) (sin usar signEvent del target). Casos: round-trip
valido true; body manipulado false; clave publica distinta false; sig null false; sig
malformado false; signature truncada false.

## Constraints
- Budget cyclomatic <= 4, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.