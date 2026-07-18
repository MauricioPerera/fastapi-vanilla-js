# SPEC1-REPORT — RBAC en endpoints de escritura de Actions

## Objetivo
Los dos endpoints de **escritura** de `routers/actions.js` (`POST /repos/:name/workflows` y
`POST /repos/:name/workflows/:wf/dispatch`) deben exigir rol administrador (`requireAdmin`), no
solo autenticación. Los endpoints de **lectura** del mismo router quedan sin cambios.

## Viabilidad (verificada antes de escribir código)
- `requireAdmin` **existe y está exportado** en `dependencies/auth.js:100-107` (junto a
  `getCurrentUser`). No hubo que crearlo.
- El patrón `dependencies: { user: requireAdmin }` como tercer argumento de la ruta está en uso en
  `routers/users.js:85,131,160`.
- `lib/fastapi.js:78` confirma que las deps a nivel ruta **pisan** las del router:
  `routeDeps = { ...(this.dependencies || {}), ...(options.dependencies || {}) }`. El router
  declara `dependencies: { user: getCurrentUser }`; al poner `dependencies: { user: requireAdmin }`
  en la ruta, esa clave `user` se sobreescribe → el endpoint exige admin. Las rutas de lectura, sin
  deps a nivel ruta, conservan `getCurrentUser`.
- `requireAdmin` internally llama a `getCurrentUser` (autentica → 401/403) y luego chequea rol
  (`_isAdmin`) → 403 si no es admin.

## Cambios aplicados
Solo `routers/actions.js` (3 líneas):

```diff
-const { getCurrentUser } = require('../dependencies/auth');
+const { getCurrentUser, requireAdmin } = require('../dependencies/auth');
```

```diff
 // POST /repos/:name/workflows (options object)
     body: {
         name: { type: 'string', required: true },
         trigger: { type: 'string', required: true },
         steps: { type: 'array', required: true }
-    }
+    },
+    dependencies: { user: requireAdmin }
 });
```

```diff
 // POST /repos/:name/workflows/:wf/dispatch (options object)
     summary: 'Disparar (dispatch) un workflow',
-    description: '...'
+    description: '...',
+    dependencies: { user: requireAdmin }
 });
```

Rutas de lectura (`GET /:name/workflows`, `GET /:name/runs`, `GET /:name/runs/:runId`): **sin
cambios** — siguen con la dependencia a nivel router (`getCurrentUser`).

No se tocó `dependencies/auth.js`, `lib/actions.js`, `lib/mcp-actions-postal-tools.js`,
`lib/fastmcp.js`, `worker.js` ni `run-all-tests.js`.

## Tests nuevos — `test-actions-authz.js`
Estilo `test-routers.js`: FastAPI in-process + `node:test`, puerto libre `8997`. Registra un user
real `roles:['user']` y otro `roles:['admin']` vía `auth.register`, los loguea y usa los **JWT
reales**. Para el caso admin usa además el bypass de dev `super-secret-token` (role
`administrator`). Crea un repo bare único `actions-authz-<rand>` como cwd y lo borra al final
(`DELETE /repos/:name` + limpieza de `.data/workflows|runs/<repo>`), como `e2e-actions.js`.

Casos (todos con assert de status HTTP real):
1. `POST /repos/:name/workflows` SIN token → **401**.
2. `POST /repos/:name/workflows` con token NO-admin → **403**.
3. `POST /repos/:name/workflows` con token admin → **200**, workflow creado.
4. `POST /repos/:name/workflows/:wf/dispatch` con token NO-admin → **403** y el step **no se
   ejecuta** (verificado: el step escribe un marcador en el cwd; tras el 403 el marcador no existe).
5. `POST /repos/:name/workflows/:wf/dispatch` con token admin → **200**, ejecuta (run `success`,
   `stdout` contiene `actions-authz-ok`).
6. `GET /repos/:name/workflows` con token NO-admin → **200** (confirma que las rutas de lectura no
   se tocaron).

### Salida real de `node --test test-actions-authz.js`
```
✔ POST /repos/:name/workflows SIN token -> 401 (2027.0228ms)
✔ POST /repos/:name/workflows con token NO-admin -> 403 (4.3151ms)
✔ POST /repos/:name/workflows con token admin -> 200, workflow creado (94.141ms)
✔ POST /repos/:name/workflows/:wf/dispatch con token NO-admin -> 403 (no ejecuta el step) (90.979ms)
✔ POST /repos/:name/workflows/:wf/dispatch con token admin -> 200, ejecuta (119.2761ms)
✔ GET /repos/:name/workflows con token NO-admin -> 200 (lectura sin cambio) (10.6923ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2823.9272
```

## Batería completa — `node run-all-tests.js`
Sin regresiones. Resumen final real:
```
========================================================
📊 REPORTE DE RESULTADOS CONSOLIDADOS
========================================================
🟢 Suite Node.js Server (test.js)            : ✓ PASSED (23/23 pruebas exitosas)
🟢 Suite CF Workers Edge (test-edge.js)      : ✓ PASSED (19/19 pruebas exitosas)
🟢 Suite FastMCP Server (test-mcp.js)        : ✓ PASSED (12/12 pruebas exitosas)
🟢 Suite Validación CCDD (validation.js)     : ✓ PASSED (42/42 pruebas exitosas)
🟢 Suite Local GitHub CCDD (repos+issues+actions+pulls): ✓ PASSED
🟢 Suite Postal CCDD (event log + projector) : ✓ PASSED
🟢 Suite Document Store (test-docstore.js)   : ✓ PASSED (14/14 pruebas exitosas)
🟢 Suite Vector Store (test-vectorstore.js)  : ✓ PASSED (10/10 pruebas exitosas)
🟢 Suite MCP Features (test-mcp-features.js) : ✓ PASSED (6/6 pruebas exitosas)
🟢 Suite Routers HTTP (test-routers.js)      : ✓ PASSED (6/6 pruebas exitosas)
🟢 Suite FastMCP SSE (test-sse.js)           : ✓ PASSED (2/2 pruebas exitosas)
🟢 Suite SSE AUTH HARDENING (test-sse-auth.js): ✓ PASSED
🟢 Suite MCP Edge Guard (test-mcp-edge-guard.js): ✓ PASSED (13/13 pruebas exitosas)
🟢 Suite E2E HTTP (server en vivo)          : ✓ PASSED (6/6 e2e verde)
--------------------------------------------------------

🏆 ¡ÉXITO TOTAL DE LA BATERÍA DE PRUEBAS! 🏆
Todas las APIs, Edge Workers, herramientas y recursos MCP funcionan de forma excelente.
```

> Nota: `test-actions-authz.js` no forma parte de `run-all-tests.js` (no se debía tocar ese
> archivo). Se ejecuta standalone con `node --test test-actions-authz.js` (ver arriba).

## Trade-offs
- **Dependencia a nivel ruta pisa la del router** (`fastapi.js:78`). Es el mismo mecanismo que usa
  `routers/users.js`, así que no introduce un patrón nuevo. Alternativa descartada: retirar
  `getCurrentUser` del router y ponerlo en cada ruta — más invasivo y fuera de alcance.
- **Caso 4 (dispatch no-admin no ejecuta)** se verificó con un marcador en disco en lugar de solo
  el status 403, para probar explícitamente que el step de shell no corre (defensa contra un futuro
  bug donde `requireAdmin` respondiera 403 pero el handler igualmente ejecutara).
- **Caso admin** usa el bypass de dev `super-secret-token` (role `administrator`), que es el
  principal consumidor del router en desarrollo; además se registró un user `roles:['admin']` real
  con JWT para cubrir la otra rama de `_isAdmin`.
- No se persisten secretos en logs ni en el repo de test (se borró el repo bare y los users al
  final).