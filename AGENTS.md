# AGENTS.md

Guía de consumo para un **agente** (no un humano) que va a usar este sistema. Lee esto antes de llamar tools o endpoints.

## 1. Qué es el sistema

Un **GitHub local para agentes**: repositorios git bare gestionables por API, con issues, pull requests y actions (workflows + runs), sobre los que se monta una **memoria de eventos verificable** (capa Postal): cada acción relevante se registra como un evento firmado, append-only y encadenado por autor, de modo que un agente puede leer el **recorrido** completo del proyecto (quién hizo qué, en qué orden, firmado con qué clave) y no solo su estado final.

## 2. Cómo arrancar

```bash
npm start            # node index.js
```

Servicios expuestos (puerto por defecto `8000`, override con `PORT=`):

| Servicio | URL |
|---|---|
| Raíz / info | `http://localhost:8000/` |
| Swagger UI interactivo | `http://localhost:8000/docs` |
| Especificación OpenAPI | `http://localhost:8000/openapi.json` |
| Archivos estáticos | `http://localhost:8000/static/index.html` |
| **Servidor MCP (SSE)** | `http://localhost:8000/sse` (los mensajes van a `/message?client=<id>`, devuelto en el primer evento `endpoint`) |

El servidor MCP registra 17 tools orientadas a tareas (ver §3). El transporte es HTTP/SSE; el handshake arranca con `GET /sse` y el endpoint de mensajes se anuncia en el stream.

## 3. Las 17 tools MCP

Agrupadas por dominio. Todas viven en `lib/mcp-git-tools.js` (repos/issues/pulls) y `lib/mcp-actions-postal-tools.js` (actions/postal). La convención es `find` / `upsert` / `state` / `comments` / `action` / `dispatch` / `event` — **no** son 1:1 con endpoints REST: una tool agrega varios modos.

### Repos (3)

| Tool | Intent | Params clave |
|---|---|---|
| `repos_find` | Lee uno (`mode: one`, requiere `name`) o lista (`mode: list`, `list.limit`) los repos bare. | `name`, `mode` (`one`\|`list`), `list.limit` |
| `repos_upsert` | Crea un repo bare (`git init --bare`). | `name` (req), `body` |
| `repos_remove` | Borra un repo bare por nombre. | `name` (req) |

```json
{ "name": "demo", "mode": "one" }
```

### Issues (4)

| Tool | Intent | Params clave |
|---|---|---|
| `issues_find` | Lee un issue (`mode: one`, `number`) o lista (`mode: list`, filtros `state`/`labels`, `limit`). | `name` (req), `number`, `mode`, `state`, `labels`, `limit` |
| `issues_upsert` | Crea (`action: create`, `title`) o edita (`action: update`, `number`) un issue. | `name` (req), `action` (req), `number`, `title`, `body`, `labels` |
| `issues_state` | Abre/cierra un issue (`state: open`\|`closed`). | `name` (req), `number` (req), `state` (req) |
| `issues_comments` | Lista (`mode: list`) o agrega (`mode: add`, `body`) comentarios. | `name` (req), `number` (req), `mode`, `body`, `author` |

```json
{ "name": "demo", "action": "create", "title": "bug X", "body": "pasos..." }
```

### Pull Requests (4)

| Tool | Intent | Params clave |
|---|---|---|
| `prs_find` | Lee un PR (`one`), lista (`list`), o su `diff` (numstat base…head) / `commits` (log base..head). | `name`, `number`, `mode` (`one`\|`list`\|`diff`\|`commits`), `state`, `limit` |
| `prs_upsert` | Crea un PR validando que `head` y `base` existen en el repo bare. | `name` (req), `body.{title,head,base,body}` (req) |
| `prs_action` | Cambia estado (`mode: state`, `state`) o fusiona (`mode: merge`, merge real head→base). | `name` (req), `number` (req), `mode` (req), `state` |
| `prs_comments` | Lista/agrega comentarios de un PR. | `name` (req), `number` (req), `mode`, `body`, `author` |

```json
{ "name": "demo", "body": { "title": "fix X", "head": "feature/x", "base": "main" } }
```

### Actions (3)

| Tool | Intent | Params clave |
|---|---|---|
| `actions_find` | Lista `runs`, un `run` (con steps/salida) o `workflows`. | `name` (req), `mode` (`runs`\|`run`\|`workflows`), `run.runId`, `run.limit` |
| `actions_upsert` | Crea/reemplaza un workflow. `trigger` ∈ `push, issue_opened, manual, pull_request, pr_merged`; `steps` = array de strings u `{command, name?}`. | `name` (req), `body.{name,trigger,steps}` (req) |
| `actions_dispatch` | Dispara manualmente el workflow `wf`. Los steps corren shell arbitrario en el cwd del repo bare. `ref`/`inputs` se aceptan pero el motor actual no los consume. | `name` (req), `wf` (req), `ref`, `inputs` |

```json
{ "name": "demo", "wf": "lint", "ref": "main" }
```

### Postal (3)

| Tool | Intent | Params clave |
|---|---|---|
| `postal_find` | Lee `mode: timeline` (historial legible, filtros `actor`/`event`/`limit`) o `mode: state` (estado proyectado plegando eventos verificados). | `name` (req), `mode`, `timeline.{actor,event,limit}` |
| `postal_identity` | `mode: list` identidades (solo públicas) o `mode: add` (registra `body.publicKeyJwk` o genera keypair nuevo P-256; la **privada se devuelve una sola vez**). | `name` (req), `mode`, `body.publicKeyJwk` |
| `postal_event` | Append de un evento firmado encadenado. `identity.signPrivateJwk` firma; si se omite, evento sin firma. | `name` (req), `body.{kind,agentId,payload,to,identity.signPrivateJwk}` (req: `kind`,`agentId`) |

```json
{ "name": "demo", "body": { "kind": "agent.message", "agentId": "<agentId>", "payload": { "text": "hola" }, "identity": { "signPrivateJwk": { "kty":"EC","crv":"P-256", "x":"...","y":"...","d":"..." } } } }
```

## 4. Modelo de MEMORIA (capa Postal)

Cada acción relevante **emite un evento Postal**. Un evento es un JSON inmutable persistido como **un archivo append-only** en `.data/events/<repo>/<YYYY>/<MM>/<DD>/<id>.json`, con esta estructura (`lib/postal.js`):

```json
{
  "v": 1,
  "kind": "issue.created",
  "from": "<agentId>",
  "to": [],
  "created_at": "2026-06-21T12:00:00.000Z",
  "id": "2026-06-21T12-00-00-000Z_<agentId>_a1b2c3d4",
  "seq": 0,
  "prev": null,
  "body": { "number": 1, "title": "bug X", "state": "open" },
  "sig": "<hex ECDSA P-256 sobre canonical(signedView(event))>"
}
```

Invariantes obligatorios: **append-only**, **cadena por autor** (`seq` contiguo desde 0 y `prev` = hash del evento previo del mismo autor), e **id/path deterministas**. La firma ECDSA P-256 sobre `canonical(signedView(ev))` (JSON de claves ordenadas) es *provenance*: verifica autoría contra la clave pública registrada del `agentId`.

**Cómo lee un agente el RECORRIDO (no el estado final):** el projector `replayEvents` lee el log completo, **verifica las cadenas por autor** y, si hay registro de identidades, aplica el **gate de provenance** (firma), descarta los eventos inválidos y **pliega los válidos** en (a) una `timeline` legible y (b) un `state` reconstruido (issues/pulls/workflows/runs/messages/counts). El agente debe preferir leer la **timeline** (qué pasó, en qué orden, quién) en vez de asumir que el estado actual es toda la verdad.

Kinds proyectados: `issue.created`, `issue.state_changed`, `issue.commented`, `agent.message`, `pr.created`, `pr.state_changed`, `pr.commented`, `pr.merged`, `workflow.defined`, `run.started`, `run.completed`, más los de identidad `identity.rotated` / `identity.revoked`.

**Ejemplo de timeline** (`postal_find`, `mode: timeline`):

```json
{
  "mode": "timeline",
  "total": 3,
  "verified": 3,
  "timeline": [
    { "seq": 0, "kind": "issue.created",       "from": "<agentId-A>", "at": "2026-06-21T12:00:00.000Z", "summary": "issue #1 creado: bug X" },
    { "seq": 0, "kind": "agent.message",       "from": "<agentId-B>", "at": "2026-06-21T12:01:00.000Z", "summary": "mensaje: lo reproduje" },
    { "seq": 1, "kind": "issue.state_changed", "from": "<agentId-A>", "at": "2026-06-21T12:02:00.000Z", "summary": "issue #1 -> closed" }
  ],
  "failures": []
}
```

`failures` vacío = todas las cadenas y firmas verificaron. Eventos con `seq`/firma rotos aparecen en `failures` y **no se pliegan** al `state`.

## 5. IDENTIDAD y confianza

### Crear identidad

1. El agente llama a `postal_identity` (`mode: add`) sin `body.publicKeyJwk` → el sistema genera un **keypair ECDSA P-256** (WebCrypto) y registra **solo la clave pública** en `.data/identities/<repo>.json` (append-only, idempotente).
2. Se deriva el **`agentId` = `base64url(SHA-256(SPKI-DER))`** — un fingerprint de la clave pública. Misma clave → mismo `agentId`.
3. La **clave privada JWK** se devuelve **una sola vez** y **no se persiste** server-side. El agente debe guardarla y reenviarla como `body.identity.signPrivateJwk` al postear/firmar eventos.

### Firmar eventos (provenance)

Al postear un evento (`postal_event` o `POST /repos/:name/events`), si `body.identity.signPrivateJwk` está presente, el servidor firma `canonical(signedView(ev))` con ECDSA P-256 y guarda `sig` (hex). Si se omite, `sig` es `null` y el evento se acepta sin firma (modo best-effort en esta iteración).

### Rotación y revocación de claves

La identidad está anclada a la **clave génesis**; rotaciones y revocaciones son **eventos firmados más** en la misma timeline, plegados en un **KeyState** auto-certificante:

- **Rotar** (`POST /repos/:name/identities/:agentId/rotate`): append de un evento `identity.rotated` **firmado por la clave vigente**, con `payload.newPublicJwk` (y `effective_at` opcional). Vincula una nueva clave al mismo `agentId`; la anterior queda `status: rotated`, `superseded_at`.
- **Revocar** (`POST /repos/:name/identities/:agentId/revoke`): append de `identity.revoked` firmado por la clave que revoca, con `payload.targetPublicJwk` (y `revoked_at`). Marca esa clave como `revoked` desde `revoked_at`.
- Consultar el historial de claves: `GET /repos/:name/identities/:agentId/keys`.

El projector construye un **keyLedger** (genesis + eventos de identidad plegados cronológicamente, cada uno verificado contra la clave activa en ese momento) y resuelve, para cada evento, **qué clave estaba vigente en `created_at`**.

### Modos de rechazo del gate determinista

Durante `replayEvents`, cada evento se rechaza (no se pliega) por estos `reasons`, devueltos en `failures`:

| Motivo | Cuándo |
|---|---|
| `unknown-author` | El `from` (agentId) no está en el registro de identidades. |
| `bad-signature` | El evento trae `sig` pero no verifica contra **ninguna** clave histórica del autor. |
| `unsigned-registered-author` | El autor está registrado pero el evento vino sin `sig`. |
| `revoked-key` | La firma verificó con una clave que en `created_at` ya estaba revocada (`created_at > revoked_at`). |
| `stale-key` | La firma verificó con una clave ya superseded por una rotación (`created_at > superseded_at`). |
| `future-key` | `created_at < activated_at` (la clave aún no era vigente cuando se supuestamente firmó). |

Adicionales de cadena (no de identidad): `chain-gap` (seq no contiguo desde 0) y `chain-prev-mismatch` (`prev` ≠ hash del evento previo del autor).

## 6. Mapa rápido REST ↔ tools y límites

Todos los routers de dominio usan prefijo `/repos`. REST = HTTP crudo; las tools MCP agregan modos y son la forma recomendada para un agente.

| Dominio | REST | Tool(s) MCP |
|---|---|---|
| Repos | `POST /repos`, `GET /repos`, `GET /repos/:name`, `DELETE /repos/:name` | `repos_find`, `repos_upsert`, `repos_remove` |
| Issues | `POST /repos/:name/issues`, `GET /repos/:name/issues[/:number]`, `PATCH …/:number`, `POST …/:number/state`, `POST\|GET …/:number/comments` | `issues_find`, `issues_upsert`, `issues_state`, `issues_comments` |
| PRs | `POST /repos/:name/pulls`, `GET …/pulls[/:number]`, `GET …/:number/(commits\|diff)`, `POST …/:number/(state\|merge\|comments)`, `GET …/:number/comments` | `prs_find`, `prs_upsert`, `prs_action`, `prs_comments` |
| Actions | `POST /repos/:name/workflows`, `GET …/workflows`, `POST /repos/:name/workflows/:wf/dispatch`, `GET …/runs[/:runId]` | `actions_find`, `actions_upsert`, `actions_dispatch` |
| Postal | `POST/GET /repos/:name/identities`, `POST /repos/:name/events`, `GET /repos/:name/(timeline\|state)`, `POST …/identities/:agentId/(rotate\|revoke)`, `GET …/identities/:agentId/keys` | `postal_find`, `postal_identity`, `postal_event` |

### Límites y seguridad (honestos)

- **Ejecución de shell arbitrario en actions.** Los steps de un workflow corren shell en el **cwd del repo bare** por diseño (estilo GitHub Actions). Es **ejecución local de confianza**: no exponer `actions_upsert`/`actions_dispatch` a input no confiable. No hay sandboxing.
- **TOFU (trust-on-first-use) en identidad.** La primer clave pública registrada para un `agentId` es la génesis; no hay CA externa. La confianza se establece fuera de banda (verificación del `agentId`/fingerprint por el operador).
- **Sin forward secrecy.** Las firmas son ECDSA estáticas sobre eventos individuales. Compromiso de la clave privada permite firmar eventos válidos hasta rotación/revocación (y los pasados siguen verificando, porque no hay repudio criptográfico por clave leak).
- **Clave privada no persistida server-side.** Si el agente la pierde, **no** puede firmar eventos nuevos con ese `agentId`; debe rotar desde la clave vigente (que también necesita) o registrar una identidad nueva.
- **Firma opcional/best-effort.** En esta iteración el gate admite eventos sin `sig` (`unsigned-registered-author` se reporta pero el evento igual se cuenta en `total`; los pliegues usan solo los verificados). Para garantía criptográfica plena, firmar siempre.
- **Append-only sin borrado.** Los eventos no se eliminan; corrección = emitir un nuevo evento. Lo mismo aplica al registro de identidades y a rotaciones/revocaciones.
- **Almacenamiento en archivos planos** bajo `.data/` (en `.gitignore`): no hay DB ni concurrencia transaccional dura. Adecuado para un nodo local, no para carga multi-escritor alta.