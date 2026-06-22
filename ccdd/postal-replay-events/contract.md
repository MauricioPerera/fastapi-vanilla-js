---
task: postal-replay-events
intent: Reconstruir el estado proyectado de un repo desde su log de eventos
target: ../../lib/postal.js
language: javascript
signature: "async function replayEvents(repoName, eventsDir, identitiesDir)"
budget: { cyclomatic_max: 6, nesting_max: 2, params_max: 3, lines_max: 20 }
deps_allowed: ["./gitRepos"]
forbids: [eval]
tests: test_replay_events.js
test_command: "node --test ../ccdd/postal-replay-events/test_replay_events.js"
spec_version: "0.1"
require_test_approval: false
---
## Intent
Projector: leer el log, verificar cadenas con el gate temporal (si hay identidades),
plegar los eventos validos en estado y construir la timeline legible.

## Interface
- replayEvents(repoName, eventsDir, identitiesDir?) -> Promise<{ state, timeline, total, verified, failures }>

## Invariants
- Repo vacio -> { state: {issues:{},pulls:{},workflows:{},runs:{},messages:[],counts:{}}, timeline: [], total: 0, verified: 0, failures: [] }.
- state se reconstruye plegando solo eventos cuya verificacion pasa verifyChains.
- Funciones disponibles en el modulo (USARLAS): listEvents(safe, eventsDir), loadIdentitiesMaybe(safe, identitiesDir), loadGenesisMap(safe, identitiesDir), buildKeyLedger(genesisMap, identityEvents), verifyChains(events, identities, keyLedger), foldEvent(state, ev), buildTimeline(verified).
- Algoritmo:
  1. safe = sanitizeRepoName(repoName); events = await listEvents(safe, eventsDir).
  2. identities = await loadIdentitiesMaybe(safe, identitiesDir).
  3. keyLedger = identities ? await buildKeyLedger(await loadGenesisMap(safe, identitiesDir), events.filter(ev => ev.kind === 'identity.rotated' || ev.kind === 'identity.revoked')) : undefined.
  4. failures = await verifyChains(events, identities, keyLedger).
  5. badSeqs = Set de f.from + ':' + f.seq; verified = events.filter(ev => typeof ev.seq !== 'number' || !badSeqs.has(ev.from + ':' + ev.seq)).
  6. state = plegar foldEvent sobre verified; timeline = buildTimeline(verified).
  7. return { state, timeline, total: events.length, verified: verified.length, failures }.
- identitiesDir ausente -> solo cadena (backward-compat: eventos sig:null validan).
- identitiesDir presente -> gate temporal (keyLedger): un evento firmado por clave
  revocada/rotada fuera de ventana se excluye del estado (stale-key / revoked-key).
- Sanitiza repoName. No muta el log.

## Examples
- replayEvents(repoVacio, dir) -> total 0, verified 0, timeline [].
- tras issue.created + agent.message validos, state refleja el recorrido.
- tras rotacion, un issue.created firmado por la clave NUEVA se proyecta; uno firmado
  por la clave VIEJA tras la rotacion se excluye (stale-key).

## Do / Don't
- DO: excluir eventos con cadena o provenance rota del estado.
- DO: construir el keyLedger desde la genesis + eventos de identidad.
- DON'T: proyectar eventos no verificados.

## Tests
Property-tests: vacio; pliega issue.created y agent.message; excluye eventos de cadena
rota del estado; pliega pr.created y run.started/completed; con identitiesDir evento
firmado valido se proyecta; con identitiesDir body manipulado -> bad-signature excluido;
temporal: evento firmado por clave nueva tras rotacion se proyecta; temporal: evento
firmado por clave vieja tras rotacion -> stale-key excluido del estado.

## Constraints
- Budget cyclomatic <= 6, nesting <= 2.
- PARAR y reportar si el gate excede el budget o si un caso del oraculo falla.