---
task: postal-verify-chains
intent: Reportar los fallos de verificacion de cada autor delegando en el gate temporal o legacy
target: ../../lib/postal.js
language: javascript
signature: "async function verifyChains(events, identities, keyLedger)"
budget: { cyclomatic_max: 7, nesting_max: 2, params_max: 3, lines_max: 20 }
deps_allowed: []
forbids: [eval]
tests: test_verify_chains.js
test_command: "node --test ../ccdd/postal-verify-chains/test_verify_chains.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Agrupar eventos por autor, verificar cada cadena (seq/prev) via verifyAuthorChain y, segun
el registro disponible, aplicar el gate de provenance: si `keyLedger` esta presente usa
verifyGroupTemporalProvenance (ventana temporal por clave), si no y `identities` esta
presente usa verifyGroupProvenance (legacy genesis-only).

## Interface
- verifyChains(events: event[], identities?: Map<agentId, publicJwk>, keyLedger?: Map<agentId, KeyState>) -> Promise<{ from, seq, reasons[] }[]>

## Invariants
- Eventos sin seq numerico se ignoran.
- Agrupa por from y delega la cadena en verifyAuthorChain.
- Funciones disponibles en el modulo (USARLAS): verifyAuthorChain(from, list), verifyGroupProvenance(from, list, identities), verifyGroupTemporalProvenance(from, list, keyLedger).
- Algoritmo:
  1. groups = groupByAuthor(events); failures = [].
  2. for [from, list] of groups:
     a. for f of await verifyAuthorChain(from, list): failures.push(f).
     b. pf = keyLedger ? await verifyGroupTemporalProvenance(from, list, keyLedger) : await verifyGroupProvenance(from, list, identities).
     c. for f of pf: failures.push(f).
  3. return failures.
- keyLedger presente -> gate temporal (subsume firma + ventana).
- keyLedger ausente e identities presente -> gate legacy genesis-only.
- ambos ausentes -> solo cadena (backward-compat con eventos historicos sig:null).
- No muta inputs.

## Examples
- verifyChains([{from,seq:0,prev:null}]) -> [] (solo cadena).
- verifyChains(eventoFirmadoValido, mapConAutor) -> [] (legacy).
- verifyChains(eventoFirmadoManipulado, mapConAutor) -> bad-signature (legacy).
- verifyChains(eventoFirmadoPorClaveActiva, null, ledger) -> [] (temporal).
- verifyChains(eventoFirmadoPorClaveRotada_tDespues, null, ledger) -> stale-key (temporal).
- verifyChains(eventoFirmadoPorClaveRevocada_tDespues, null, ledger) -> revoked-key (temporal).

## Do / Don't
- DO: delegar por autor en verifyAuthorChain y el gate de provenance correspondiente.
- DO: elegir el gate por presencia de keyLedger.
- DON'T: verificar cross-author; DON'T: aplicar gate de firma si ambos registros son undefined.

## Tests
Property-tests: sin seq se ignoran; autor roto aislado; backward-compat sin registros;
legacy con identities y firma valida / body manipulado; temporal con clave activa -> [];
temporal con clave rotada -> stale-key; temporal con clave revocada -> revoked-key.

## Constraints
- Budget cyclomatic <= 7, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.