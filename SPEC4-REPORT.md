# SPEC4-REPORT — Límites del runtime Node (`lib/fastapi.js`)

Cubre el hallazgo de auditoría previa: *"sin rate-limit ni límite de body fuera de /mcp"*.
**Alcance:** SOLO runtime Node (`lib/fastapi.js`). El runtime Edge
(`lib/fastapi-edge.js`, `worker.js`) queda fuera — no se tocó.

## Qué se hizo

### 1. Límite de body (413) en `_parseJsonBody`
- `FastAPI` ahora acepta `maxBodyBytes` en el constructor (`new FastAPI({ ..., maxBodyBytes: N })`).
  Default `5 * 1024 * 1024` (5 MB). Si no se pasa, usa el default.
- `_parseJsonBody` acumula en **buffers** (antes: string) y lleva un contador `size` de bytes.
  En cada chunk, `size += chunk.length` y, **si `size > maxBodyBytes`**, corta de inmediato:
  remueve los listeners, hace `req.pause()` (deja de consumir; no destruye el socket, así
  `res` queda usable) y rechaza con `PayloadTooLargeError` (status 413, `expose: true`).
  **No espera a que termine de llegar el body ni a parsearlo.**
- El rechazo propaga a `_handleRequest` → `_handleException` → `defaultExceptionHandler`,
  que ahora honra `err.status` + `err.expose` respondiendo `{ detail: "Payload Too Large" }`
  con **413**. El handler de la ruta **nunca se ejecuta** (el `await this._parseJsonBody(req)`
  lanza antes de llegar al dispatch).
- Comportamiento con bodies normales (todos chicos): **idéntico a hoy**. El default de 5 MB
  no rompe ningún caso existente (verificado con `test.js` y `test-routers.js` en batería).

### 2. Rate limiter opt-in (`createRateLimiter`) — `lib/rate-limit.js`
- `createRateLimiter({ windowMs, max, keyFn })` → middleware `(req, res, next) => {}`,
  compatible con `app.addMiddleware(...)` (misma firma que `index.js:29`).
- Re-exportado desde `lib/fastapi.js` (`module.exports`).
- **No se cablea en `index.js`** — queda opt-in, igual que `coerce`/`model` en las rutas.
- `keyFn` default: IP (`req.socket.remoteAddress`); overrideable (p.ej. por token/usuario).
- Al exceder: responde **429** con `{ detail: "Too Many Requests" }` y **NO llama a `next()`**.
- In-memory, zero-dependencias, no sobrevive restart (coherente con el resto del núcleo).

## Trade-off de diseño: ventana deslizante vs token bucket

Elegí **ventana deslizante (sliding window log)**: por cada clave guardo los timestamps
(ms) de las requests aceptadas; en cada llamada podamos las que cayeron fuera de
`windowMs` y cuento las restantes. Si `>= max`, 429.

Por qué descarté **token bucket**: permite ráfagas hasta `capacity` + recarga continua,
lo que hace que la semántica de "max requests por ventana" sea difusa. Con token bucket,
un `max: 3` con recarga de 1 token cada `windowMs/3` dejaría pasar una 4ª request casi
inmediatamente si la recarga ya avanzó — ambiguo para el test "el 4º dentro de la
ventana → 429". La ventana deslizante da exactamente "como mucho `max` requests en
cualquier ventana de `windowMs`", determinista y trivial de verificar (tras `windowMs`
la ventana queda vacía → vuelve a aceptar). Coste: memoria O(requests activas por clave)
y poda por clave; aceptable para un limiter en memoria sin dependencias. No necesitamos
las propiedades de ráfaga controlada del token bucket, sí precisión de "max por ventana".

## Evidencia

### `node --test test-fastapi-limits.js`
```
✔ POST /echo con body chico -> 200 (comportamiento sin cambios) (46.9551ms)
✔ POST /echo con body > maxBodyBytes -> 413 y el handler NO se ejecuta (3.8859ms)
✔ POST /default con ~1KB y maxBodyBytes NO configurado (default) -> 200 (3.4301ms)
✔ createRateLimiter: 3 requests -> 200, 4to -> 429, tras windowMs -> 200 (271.8054ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 407.9902
```

### `node run-all-tests.js` (resumen final)
```
🟢 Suite Node.js Server (test.js)            : ✓ PASSED (23/23)
🟢 Suite CF Workers Edge (test-edge.js)      : ✓ PASSED (19/19)
🟢 Suite FastMCP Server (test-mcp.js)         : ✓ PASSED (12/12)
🟢 Suite Validación CCDD (validation.js)     : ✓ PASSED (42/42)
🟢 Suite Local GitHub CCDD                   : ✓ PASSED
🟢 Suite Postal CCDD                         : ✓ PASSED
🟢 Suite Document Store (test-docstore.js)   : ✓ PASSED (14/14)
🟢 Suite Vector Store (test-vectorstore.js)  : ✓ PASSED (10/10)
🟢 Suite MCP Features (test-mcp-features.js) : ✓ PASSED (6/6)
🟢 Suite Routers HTTP (test-routers.js)      : ✓ PASSED (6/6)
🟢 Suite FastMCP SSE (test-sse.js)            : ✓ PASSED (2/2)
🟢 Suite SSE AUTH HARDENING                  : ✓ PASSED
🟢 Suite MCP Edge Guard                      : ✓ PASSED (13/13)
🟢 Suite Actions AuthZ REST                  : ✓ PASSED (6/6)
🟢 Suite Actions AuthZ MCP                    : ✓ PASSED (4/4)
🟢 Suite E2E HTTP (server en vivo)           : ✓ PASSED (6/6 e2e verde)
🏆 ¡ÉXITO TOTAL DE LA BATERÍA DE PRUEBAS!
```

## Archivos tocados
- `lib/fastapi.js` — `PayloadTooLargeError`, `maxBodyBytes` en constructor,
  `_parseJsonBody` con corte, `defaultExceptionHandler` honra `err.status`/`err.expose`,
  re-export de `createRateLimiter`.
- `lib/rate-limit.js` (nuevo) — `createRateLimiter` (ventana deslizante).
- `test-fastapi-limits.js` (nuevo) — 4 casos, node:test + assert de status HTTP real.

No se tocaron `index.js`, `lib/fastapi-edge.js`, `worker.js`, `functions/[[path]].js`,
`run-all-tests.js`.

## Abortar — condición evaluada
No se activó. Cortar a mitad de stream no requirió reescribir el manejo de eventos del
request de forma estructural: basta con un contador de bytes y remover listeners en el
handler `data`. `req.pause()` (en vez de `req.destroy()`) evita matar el socket compartido
y deja `res` usable para responder el 413. Sin bloqueos.