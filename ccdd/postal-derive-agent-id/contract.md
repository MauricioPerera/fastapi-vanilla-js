---
task: postal-derive-agent-id
intent: Derivar un agentId determinista desde la clave publica ECDSA P-256
target: ../../lib/postal.js
language: javascript
signature: "async function deriveAgentId(publicSpkiBuffer)"
budget: { cyclomatic_max: 4, nesting_max: 2, params_max: 1, lines_max: 12 }
deps_allowed: []
forbids: [eval]
tests: test_derive_agent_id.js
test_command: "node --test ../ccdd/postal-derive-agent-id/test_derive_agent_id.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Calcular el agentId (fingerprint) anclado a la clave publica: base64url(SHA-256(SPKI DER)).

## Interface
- deriveAgentId(publicSpkiBuffer: ArrayBuffer|Uint8Array) -> Promise<string>

## Invariants
- Determinista: misma clave publica -> mismo agentId.
- Formato base64url SIN padding (sin '='), charset [A-Za-z0-9_-].
- Usa SHA-256 sobre los bytes DER SPKI de la clave publica.
- No toca disco; puro.

## Examples
- deriveAgentId(spkiDeClaveA) === deriveAgentId(spkiDeClaveA).
- deriveAgentId(spkiDeClaveA) !== deriveAgentId(spkiDeClaveB).

## Do / Don't
- DO: SHA-256 sobre el buffer recibido y base64url sin padding.
- DON'T: hashear la JWK o el PEM; siempre el SPKI DER crudo.

## Tests
Property-tests con vectores cripto reales (WebCrypto generateKey + exportKey('spki')):
determinismo; charset base64url sin padding; diferencia entre dos claves; coincide con
SHA-256 calculado independientemente con node 'crypto'.

## Constraints
- Budget cyclomatic <= 4, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.