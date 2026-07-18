# SPEC2-REPORT — RBAC admin-only en tools MCP SSE (actions_upsert / actions_dispatch)

## Objetivo
Exigir rol admin del usuario autenticado de la conexión SSE al invocar `tools/call`
con `actions_upsert` o `actions_dispatch`. Sin rol admin → error JSON-RPC (no 500, no
crash) y el tool **no se ejecuta** (sin workflow creado, sin run disparado). El resto de
los tools MCP siguen funcionando igual para cualquier usuario autenticado.

## Archivos tocados
- `dependencies/auth.js` — exporté `_isAdmin` en `module.exports` (sin tocar su lógica).
- `lib/fastmcp.js` — firma `tool(...)` con 5º arg `opts`, gating en `tools/call`,
  `_sseAuth` devuelve el usuario, `_handleMessage(req, ctx)`, exception handler propaga
  `err.rpcCode`.
- `lib/mcp-actions-postal-tools.js` — `{ requiresAdmin: true }` al registrar
  `actions_upsert` y `actions_dispatch`.
- `test-mcp-actions-authz.js` — nuevo, raíz del repo.

No toqué `routers/actions.js`, `lib/actions.js`, `worker.js`, `functions/[[path]].js`,
`run-all-tests.js`, ni `lib/mcp-features.js` / `lib/mcp-git-tools.js`.

## Cómo resolví pasar el usuario/rol hasta el dispatcher (trade-off central)
El handler de `tools/call` solo recibía `params.arguments`; no había forma de saber qué
usuario autenticado hizo la call. Resolución:

1. `_sseAuth(req, res)` antes hacía `await getCurrentUser(...)` y devolvía `true`.
   Ahora **devuelve el principal autenticado** (`return await getCurrentUser(req, res)`).
   Sigue siendo usable como guard booleano: un objeto usuario es truthy, y `false` solo
   en fallo (donde el handler hace `return` antes). El bypass de dev devuelve
   `{ role: 'administrator' }`; un JWT real devuelve el user con `roles: [...]`.
2. El handler `POST /message` guarda ese usuario: `const user = await this._sseAuth(...)`.
3. Se pasa al dispatcher: `_handleMessage(requestJsonRpc, { user })`.
4. En `tools/call`, **antes** de invocar `tool.handler`, si `tool.requiresAdmin` y hay
   `ctx.user` y `!_isAdmin(ctx.user)` → throw con `err.rpcCode = -32001`. El
   `defaultExceptionHandler` ahora respeta `err.rpcCode` (si no, default `-32603`).

**Trade-off STDIO:** el transporte STDIO (`start()`) no tiene usuario ni auth. La
verificación se aplica **solo cuando hay `ctx.user`** (`user !== undefined`). Sobre
STDIO se conserva el comportamiento local previo (no se bloquea). Esto es seguro en la
práctica porque `mcp.js` (único entrypoint STDIO) registra solo `registerSystemFeatures`
— los tools de actions/postal **nunca** se exponen por STDIO; solo por SSE en `index.js`,
donde sí hay `ctx.user`. Si en el futuro se cablearan tools `requiresAdmin` a un
transporte STDIO, revisar este supuesto (documentado en el comentario del dispatcher).

**Code JSON-RPC:** usé `-32001` (rango `-32000` a `-32099` reservado a errores de server
por la spec JSON-RPC 2.0). No es estándar MCP fijo; es un code de server custom claro y
distinto del `-32603` de error interno. Mensaje: `"Forbidden: se requiere rol
administrador"`.

**Sin efectos secundarios:** el chequeo corre antes de `await tool.handler(...)`, así
que un reject no crea workflow ni dispara shell. Verificado en disco por los tests 1 y 2.

## Compatibilidad hacia atrás de la firma `mcp.tool()`
El 5º arg `opts` es **opcional** con default `{}`. Los ~17 registros existentes en
`lib/mcp-features.js` y `lib/mcp-git-tools.js` llaman con 4 args y siguen funcionando sin
tocarlos (verificado: `test-mcp-features.js` 6/6, `test-sse.js` 2/2, `test-sse-auth.js`
PASS, `test-mcp-edge-guard.js` 13/13). El shim recolector de
`ccdd/mcp-tools-gate.js` ignora el 5º arg (`/*, handler */`), así que el gate de
superficie tampoco se rompe. **No hubo conflicto** — no se disparó la condición de ABORT.

## test-mcp-actions-authz.js — casos
Levanta servidor con SSE real (puerto 0), registra `registerActionsPostalTools`, crea un
usuario NO-admin real (`roles: ['user']`, JWT) y usa el bypass dev como admin. Cada caso
abre el stream SSE, negocia `clientId`, hace `POST /message` con `tools/call` y lee la
respuesta JSON-RPC del stream (patrón de `test-sse.js`).

1. `actions_upsert` NO-admin → error `-32001`, sin `result`, workflow **no** en disco.
2. `actions_dispatch` NO-admin → error `-32001`, sin `result`, dir de runs **no** creado.
3. `actions_upsert` admin (bypass) → `result.isError:false`, workflow **sí** en disco.
4. `actions_find` (tool NO marcado) NO-admin → éxito (confirma que el resto no cambió).

### Salida real `node --test test-mcp-actions-authz.js`
```
[FastMCP] Herramienta registrada: [actions_find]
[FastMCP] Herramienta registrada: [actions_upsert] (admin-only)
[FastMCP] Herramienta registrada: [actions_dispatch] (admin-only)
[FastMCP] Herramienta registrada: [postal_find]
[FastMCP] Herramienta registrada: [postal_identity]
[FastMCP] Herramienta registrada: [postal_event]
[FastMCP] Cliente SSE conectado exitosamente. ID asignado: [mrpteb7msteg]
[FastMCP] Ejecutando herramienta: [actions_upsert]
[FastMCP] Error procesando método [tools/call]: Forbidden: se requiere rol administrador
✔ actions_upsert con token NO-admin -> error JSON-RPC -32001 y no crea workflow (424.4474ms)
[FastMCP] Cliente SSE desconectado. Removiendo ID: [mrpteb7msteg]
[FastMCP] Cliente SSE conectado exitosamente. ID asignado: [mrpteb88r299]
[FastMCP] Ejecutando herramienta: [actions_dispatch]
[FastMCP] Error procesando método [tools/call]: Forbidden: se requiere rol administrador
✔ actions_dispatch con token NO-admin -> error JSON-RPC -32001 y no crea run (11.1242ms)
[FastMCP] Ejecutando herramienta: [actions_upsert]
✔ actions_upsert con token admin -> éxito y crea workflow (65.5673ms)
[FastMCP] Ejecutando herramienta: [actions_find]
✔ actions_find con token NO-admin -> éxito (lectura sin cambio) (6.1143ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 4611.4248
```

### Salida real `node run-all-tests.js` (consolidado, tail)
```
🟢 Suite Node.js Server (test.js)              : ✓ PASSED (23/23)
🟢 Suite CF Workers Edge (test-edge.js)        : ✓ PASSED (19/19)
🟢 Suite FastMCP Server (test-mcp.js)          : ✓ PASSED (12/12)
🟢 Suite Validación CCDD (validation.js)       : ✓ PASSED (42/42)
🟢 Suite Local GitHub CCDD (repos+issues+...)  : ✓ PASSED
🟢 Suite Postal CCDD (event log + projector)   : ✓ PASSED
🟢 Suite Document Store (test-docstore.js)     : ✓ PASSED (14/14)
🟢 Suite Vector Store (test-vectorstore.js)    : ✓ PASSED (10/10)
🟢 Suite MCP Features (test-mcp-features.js)   : ✓ PASSED (6/6)
🟢 Suite Routers HTTP (test-routers.js)        : ✓ PASSED (6/6)
🟢 Suite FastMCP SSE (test-sse.js)             : ✓ PASSED (2/2)
🟢 Suite SSE AUTH HARDENING (test-sse-auth.js) : ✓ PASSED
🟢 Suite MCP Edge Guard (test-mcp-edge-guard.js): ✓ PASSED (13/13)
🟢 Suite E2E HTTP (server en vivo)             : ✓ PASSED (6/6 e2e verde)
🏆 ¡ÉXITO TOTAL DE LA BATERÍA DE PRUEBAS! 🏆
```
`run-all-tests.js` corrió verde en su totalidad (incluidos los suites que comparten
`lib/fastmcp.js`: `test-sse.js`, `test-sse-auth.js`, `test-mcp-edge-guard.js`,
`test-mcp.js`, `test-mcp-features.js`). `routers/actions.js` figuraba modificado en el
working tree (dev en paralelo) y no provocó fallos. Nota: `run-all-tests.js` no incluye
`test-mcp-actions-authz.js` ni `test-actions-authz.js` en su lista consolidada (no toqué
ese runner, por alcance); la verificación específica corre vía `node --test
test-mcp-actions-authz.js` (verde arriba).

## Reglas
- Sin procesos en foreground que no terminen solos: los tests abren/cierran el server y
  los streams SSE (AbortController + `server.close()` en `test.after`).
- No se loguearon tokens ni secretos (el bypass `super-secret-token` es literal pública
  de dev, ya usada así en `test-sse-auth.js` / `test-actions-authz.js`).