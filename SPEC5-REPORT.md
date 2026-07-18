# SPEC5-REPORT — Observabilidad del runtime Node (index.js)

> Alcance: **solo** `index.js` + nuevo `test-observability.js`. Edge/Workers, `lib/fastapi.js`,
> `dependencies/db.js` y `run-all-tests.js` **no se tocaron** (db.js sólo se leyó).

## 1. Qué se implementó

### 1.1 `GET /health` (público, sin auth)
- Ruta pública: registrada con `app.get('/health', handler)` **sin** `dependencies: { user: getCurrentUser }`, así no exige `Authorization` (igual que el endpoint raíz `/`).
- Respuesta `200`:
  ```json
  { "status": "ok", "uptime": <segundos>, "timestamp": "<ISO>", "checks": { "db": true } }
  ```
- `uptime` = `Math.round((Date.now() - startedAt) / 1000)`, con `startedAt = Date.now()` capturado al cargar el módulo (arriba de todo en `index.js`).
- `checks.db` es una verificación **real y barata**: `db.collection('_cpt_schemas').count()`.
  - Devuelve un número → `db = true`.
  - Lanza (adapter/disco roto) → se atrapa, `db = false` y se arma `detail`.
- Si `db` falla → `503` con `status: "degraded"` y `detail: { db: <mensaje> }` (no un 200 mentiroso).

### 1.2 Logging estructurado (middleware existente, ~línea 29)
- Se reutilizó la variable `safeUrl` ya redactada de tokens (misma regex `token=<redacted>`); **no se duplicó** la lógica de redacción.
- Nueva rama activada **solo** por `process.env.LOG_FORMAT === 'json'`:
  ```js
  console.log(JSON.stringify({ timestamp, method, path: safeUrl, status: res.statusCode, durationMs: duration }));
  ```
- **Sin** `LOG_FORMAT` → rama `else` con el `console.log` de texto coloreado **byte-idéntico** al original. El default que usan todos los tests no cambia.
- Cero dependencias externas (requisito duro cumplido).

## 2. Cómo se testea `index.js` sin romper `node index.js` (trade-off clave)

Hallazgo previo a codificar: `index.js` **ya** tiene `module.exports = app` (línea 231) **y ya** llama
`app.listen(PORT)` al cargar el módulo (línea 222). Es decir, el `require('./index.js')` tiene el
efecto lateral de arrancar el servidor completo (listen + seed de DB + MCP + estáticos).

Decisión de diseño tomada (sin modificar el path de arranque real):
1. En `test.before` se setea `process.env.PORT = 8995` **antes** de `require('./index.js')`, así el
   `index.js` **real** (con el `/health` y el middleware reales) bootea en ese puerto único.
2. El `app` exportado expone `app.server` (el `http.Server` que `app.listen` guarda en `this.server`,
   ver `lib/fastapi.js:404`). El test espera el evento `listening` y luego ejercita los endpoints con
   `fetch`.
3. En `test.after` se cierra `app.server`. No se modifica `index.js` para exportar nada nuevo (ya
   exportaba) ni para cambiar el `listen`. `node index.js` sigue siendo el arranque real intacto.

Por qué no se replicó una app mínima estilo `test-routers.js`: el objetivo de SPEC5 es verificar la
observabilidad **del `index.js` real** (el endpoint `/health` y el middleware de logging tal cual
viven en producción). Replicar una app mínima probaría una copia, no el código real. Requiriendo
`index.js` se ejercita el código de producción exacto. El costo es que `require` arranca el server
completo (side-effect de `listen` que ya existía); se mitigó con un `PORT` único y cierre de
`app.server`.

Trade-off aceptado: el test depende de que `app.listen` deje `this.server` accesible (contrato de
`lib/fastapi.js`, que no se modificó). Si esa implementación cambiara, el test se rompería — pero
rompería también el e2e HTTP de `run-all-tests.js` que spawnea `index.js`, así que es un punto de
falla compartido y monitoreado.

## 3. Casos del test (`test-observability.js`, `node:test` + `assert`)

Serialización: los subtests corren con `{ concurrency: 1 }` (los de logging mutan `process.env` y
`console.log`; no pueden correr en paralelo contra los de health ni entre sí).

1. `GET /health` → `200`, `status: "ok"`, `uptime` numérico (no NaN, ≥0), `timestamp` parseable como
   fecha ISO válida (`new Date(ts)` no NaN), `checks.db === true`.
2. `GET /health` **sin** `Authorization` → `200` (no `401`).
3. `GET /health` → `503` `degraded` cuando el check de db falla (se monkeypatchea
   `db.collection` para lanzar; se restaura en `finally`). Verifica `status: "degraded"`,
   `checks.db === false` y `detail.db` presente. **Confirma que `db` no es un `true` hardcodeado.**
4. Logging con `LOG_FORMAT=json`: se setea el env, se mockea `console.log` (restaurado en `finally`),
   se hace una request, se espera 30ms al flush del middleware, y se verifica que se emite una línea
   `JSON.parse`-able con `timestamp/method/path/status/durationMs`.
5. Logging **sin** `LOG_FORMAT`: la línea contiene `"Status:"` y códigos ANSI (`\x1b[`) y **no** es
   `JSON.parse`-able (`assert.throws`). Confirma que el default de texto no cambió.

## 4. Salida real de comandos

### `node --test test-observability.js`

```
▶ observability
  ✔ GET /health -> 200, status ok, uptime numérico, timestamp ISO, checks.db true (53.1973ms)
  ✔ GET /health sin Authorization -> 200 (no 401) (5.0405ms)
  ✔ GET /health -> 503 degraded si db falla (check real, no hardcodeado) (2.1199ms)
  ✔ logging con LOG_FORMAT=json emite una línea JSON parseable con las claves (36.6735ms)
  ✔ logging default (sin LOG_FORMAT) sigue siendo texto coloreado, no JSON (32.5883ms)
✔ observability (131.3684ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 244.6876
```

(En el log del servidor se vio durante el caso 3: `GET /health - Status: 503 (0ms)`, confirmando
el path degradado real.)

### `node run-all-tests.js` (resumen final real)

```
🟢 Suite Node.js Server (test.js)            : ✓ PASSED (23/23 pruebas exitosas)
🟢 Suite CF Workers Edge (test-edge.js)       : ✓ PASSED (19/19 pruebas exitosas)
🟢 Suite FastMCP Server (test-mcp.js)         : ✓ PASSED (12/12 pruebas exitosas)
🟢 Suite Validación CCDD (validation.js)      : ✓ PASSED (42/42 pruebas exitosas)
🟢 Suite Local GitHub CCDD (repos+issues+actions+pulls) : ✓ PASSED
🟢 Suite Postal CCDD (event log + projector)  : ✓ PASSED
🟢 Suite Document Store (test-docstore.js)    : ✓ PASSED (14/14 pruebas exitosas)
🟢 Suite Vector Store (test-vectorstore.js)   : ✓ PASSED (10/10 pruebas exitosas)
🟢 Suite MCP Features (test-mcp-features.js)  : ✓ PASSED (6/6 pruebas exitosas)
🟢 Suite Routers HTTP (test-routers.js)       : ✓ PASSED (6/6 pruebas exitosas)
🟢 Suite FastMCP SSE (test-sse.js)            : ✓ PASSED (2/2 pruebas exitosas)
🟢 Suite SSE AUTH HARDENING (test-sse-auth.js): ✓ PASSED
🟢 Suite MCP Edge Guard (test-mcp-edge-guard.js): ✓ PASSED (13/13 pruebas exitosas)
🟢 Suite Actions AuthZ REST (test-actions-authz.js): ✓ PASSED (6/6 pruebas exitosas)
🟢 Suite Actions AuthZ MCP (test-mcp-actions-authz.js): ✓ PASSED (4/4 pruebas exitosas)
🟢 Suite E2E HTTP (server en vivo)            : ✓ PASSED (6/6 e2e verde)
--------------------------------------------------------
🏆 ¡ÉXITO TOTAL DE LA BATERÍA DE PRUEBAS! 🏆
```

`test-observability.js` **no** se agregó a `run-all-tests.js` (no estaba en alcance y la SPEC
prohíbe tocarlo). Se ejecuta aparte con `node --test test-observability.js`.

## 5. Abortar si…

No ocurrió. `module.exports = app` ya existía y coexiste con `app.listen(...)` sin romper el
arranque real: `node index.js` (verificado en smoke test con `PORT=8994`) levanta el servidor en el
puerto esperado y sale limpio. No fue necesario modificar `index.js` para exportar.

## 6. Archivos tocados

- `index.js` — 3 edits: `startedAt`, rama `LOG_FORMAT=json` en el middleware, endpoint `GET /health`.
- `test-observability.js` — nuevo (raíz del repo), `node:test` + `node:assert`, zero dependencias.