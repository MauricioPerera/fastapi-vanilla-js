---
task: postal-register-identity
intent: Registrar la identidad publica de un agente en un repo (append-only)
target: ../../lib/postal.js
language: javascript
signature: "async function registerIdentity(repoName, identitiesDir, publicJwk)"
budget: { cyclomatic_max: 5, nesting_max: 2, params_max: 3, lines_max: 20 }
deps_allowed: ["./gitRepos"]
forbids: [eval]
tests: test_register_identity.js
test_command: "node --test ../ccdd/postal-register-identity/test_register_identity.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Persistir la clave publica de un agente en el registro de identidades del repo, derivando
su agentId (fingerprint) desde la propia clave. Append-only: nunca sobrescribe ni borra.

## Interface
- registerIdentity(repoName, identitiesDir, publicJwk: JsonWebKey) -> Promise<{agentId, publicKeyJwk, existed}>

## Invariants
- agentId se DERIVA via deriveAgentId(SPKI de publicJwk): la identidad se ancla a la clave.
- Archivo: <identitiesDir>/<repo>.json con { identities: [{agentId, publicJwk, registered_at}] }.
- Idempotente: registrar la misma publicJwk dos veces NO duplica la entrada; devuelve
  existed=true la segunda vez. La primera vez existed=false.
- Claves publicas distintas -> agentIds distintos -> entradas distintas.
- Solo persiste la CLAVE PUBLICA; jamas la privada.
- repoName invalido -> lanza RepoError (via sanitizeRepoName).

## Examples
- registerIdentity("r", dir, jwkA) -> {agentId: idA, publicJwk: jwkA, existed: false}.
- registerIdentity("r", dir, jwkA) de nuevo -> existed: true, una sola entrada en disco.
- registerIdentity("r", dir, jwkB) -> agentId distinto, dos entradas en disco.

## Do / Don't
- DO: re-exportar SPKI de publicJwk y derivar agentId con deriveAgentId.
- DON'T: aceptar agentId arbitrario del llamante (se deriva, no se declara).
- DON'T: persistir la clave privada; DON'T: sobrescribir entradas previas.

## Tests
Property-tests con claves cripto reales: registro inicial; idempotencia (no duplica, existed
true); dos claves -> dos entradas y agentIds distintos; agentId coincide con deriveAgentId
independiente; repo invalido lanza RepoError; append-only (entrada previa preservada).

## Constraints
- Budget cyclomatic <= 5, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.