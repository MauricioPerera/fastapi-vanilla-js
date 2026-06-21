# Desplegar el servidor MCP en cuentas temporales de Cloudflare

El Worker de este repo (`worker.js`) expone un servidor **MCP (Model Context Protocol)**
en `POST /mcp` mediante transport **Streamable HTTP stateless** (ver
[`lib/fastmcp-edge.js`](../lib/fastmcp-edge.js)). Como **solo usa el producto Workers**
(sin Durable Objects, AI, R2, Vectorize ni dominios propios), es **desplegable tal cual
en una cuenta temporal de Cloudflare**: sin login, sin token, en segundos.

Este documento explica cómo hacerlo y, sobre todo, **qué límites tener presentes durante
el desarrollo** para no diseñar algo que la cuenta temporal no soporta.

---

## 1. Qué es una cuenta temporal

Cloudflare permite a un agente/desarrollador desplegar un Worker **sin crear cuenta ni
autenticarse**. Se provisiona una cuenta efímera al vuelo, se genera un token interno y se
imprime una **URL de reclamo** (claim). Si no se reclama, **todo se borra a los 60 minutos**.

- Pensado para agentes de IA que necesitan desplegar sin pasar por OAuth/MFA.
- La cuenta se **reutiliza** entre comandos dentro de la ventana (no crea una nueva por cada
  `--temporary`).
- Para conservarla (URL + datos), se **reclama** desde el dashboard con el link impreso.

---

## 2. Requisitos

| Requisito | Detalle |
|---|---|
| **Wrangler** | `>= 4.102.0` (verifica con `wrangler --version`) |
| **Estado de sesión** | Debes estar **deslogueado**. `--temporary` **falla si ya estás autenticado**. |

```bash
# Si estás logueado, cierra sesión primero (reversible: luego wrangler login)
wrangler logout
# y asegúrate de NO tener el token de entorno
unset CLOUDFLARE_API_TOKEN        # PowerShell: $env:CLOUDFLARE_API_TOKEN = $null
```

---

## 3. Configuración de Wrangler para el Worker

> El `wrangler.toml` del repo está configurado para **Pages** (`pages_build_output_dir`),
> que **NO** es soportado por cuentas temporales. Para desplegar el Worker MCP necesitas un
> config de **Worker** aparte. No sobreescribas el de Pages.

Crea `wrangler.worker.toml` (mínimo, sin estado persistente):

```toml
name = "fastapi-vanilla-js-mcp"
main = "worker.js"
compatibility_date = "2025-06-01"

[vars]
# Permite arrancar sin secreto JWT (SOLO desarrollo/sandbox).
ALLOW_DEV_BYPASS = "1"
```

Si quieres **persistencia entre requests** (DocStore/VectorStore sobre KV), añade un KV.
Ver §5 — el `id` se obtiene en tiempo de despliegue y **es distinto en cada cuenta temporal**.

---

## 4. Desplegar

```bash
wrangler deploy --temporary --config wrangler.worker.toml
```

Salida relevante:

```
Temporary account ready:
    Account: <nombre-aleatorio> (created)
    Claim within: 60 minutes
    Claim URL: https://dash.cloudflare.com/claim-preview?claimToken=...
  https://fastapi-vanilla-js-mcp.<cuenta>.workers.dev
```

El endpoint MCP queda en:

```
https://fastapi-vanilla-js-mcp.<cuenta>.workers.dev/mcp
```

### Probar el handshake MCP (Streamable HTTP)

```bash
curl -s https://<...>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Tools expuestas por este Worker: `system_status`, `list_items`, `create_item`,
`vector_search`, y el recurso `sistema://estado`.

---

## 5. Persistencia opcional con KV (y el gotcha del `id`)

KV **sí** está soportado en cuentas temporales. Sin él, cada request corre en un *isolate*
distinto y **el estado en memoria no se comparte** (p.ej. creas un ítem y al listarlo aparece
vacío). Con KV, el DocStore/VectorStore persisten dentro de la ventana.

```bash
# 1) Crear el namespace (reutiliza la cuenta temporal viva)
wrangler kv namespace create MY_KV --temporary --config wrangler.worker.toml
# -> imprime un id NUEVO, p.ej. id = "f670611ede4a4cc59204954be6bbd931"
```

Añade el binding al config y vuelve a desplegar:

```toml
[[kv_namespaces]]
binding = "MY_KV"
id = "<el-id-que-te-dio-el-comando>"
```

> ⚠️ **El `id` del KV pertenece a esa cuenta temporal.** Si la cuenta expira y creas una
> nueva, ese `id` **ya no existe** y el deploy fallará. Hay que recrear el KV y actualizar el
> `id` cada vez (es **scriptable**).

D1 funciona igual: `wrangler d1 create <db> --temporary` → te da un `database_id` por cuenta.

---

## 6. Límites de la cuenta temporal (TENER EN CUENTA AL DESARROLLAR)

### 6.1 Productos soportados y sus topes

| Producto | Soportado | Límite |
|---|:---:|---|
| **Workers** | ✅ | Despliegue **solo a `workers.dev`** (sin dominio propio) |
| **Workers Static Assets** | ✅ | Máx. **1.000 archivos**, **5 MiB** c/u |
| **Workers KV** | ✅ | Operativo con credenciales temporales |
| **D1** | ✅ | **1 base de datos**, **100 MB** por BD / 100 MB total |
| **Durable Objects** | ✅ | Incl. SQLite-backed |
| **Hyperdrive** | ✅ | Hasta **2 configuraciones**, **10 conexiones** |
| **Queues** | ✅ | Máx. **10 colas** |
| **SSL/TLS** | ✅ | Operativo |

### 6.2 Productos NO soportados (rompen el deploy o degradan funciones)

| Producto | Impacto en este repo |
|---|---|
| **Workers AI** (`env.AI`) | ❌ `/chat/copilot`, `/vectors/upsert-text`, `/vectors/search-text` responden **503**. La tool MCP `vector_search` con **vectores manuales sí funciona**; la búsqueda por texto (embeddings) no. |
| **Vectorize** | ❌ No disponible. |
| **R2** | ❌ No disponible. |
| **Analytics Engine** | ❌ No disponible. |
| **Pages** | ❌ Usa el Worker (`worker.js`), no el deploy de Pages. |
| **Custom Domains** | ❌ Solo `workers.dev`. |

### 6.3 Límites operativos

- **Vida útil: 60 minutos** sin reclamar. Todo (Worker, KV, D1, Queues, DO) se borra al expirar.
  → Si el flujo produce un resultado, **expórtalo antes del minuto 60** (p.ej. `wrangler d1 export`).
- **Rate limit de creación de cuentas:** crear muchas cuentas temporales demasiado rápido falla;
  hay que esperar o autenticar con una cuenta permanente.
- **Runtime:** la documentación **no especifica** CPU/requests-día para estas cuentas. Asume los
  límites del **plan Free de Workers** (≈100k req/día, ~10 ms CPU/invocación) como referencia
  **no confirmada**; no diseñes cargas pesadas sobre esa suposición.

### 6.4 Seguridad

- La URL `*.workers.dev` es **pública y el `/mcp` no tiene auth por defecto**: cualquiera con la
  URL puede invocar las tools durante la hora. Para algo sensible, añade un token (en KV o un
  header compartido) **antes** de exponer la URL.
- `ALLOW_DEV_BYPASS=1` habilita el bypass de autenticación del Worker (token `edge-secret-token`).
  Es **solo para sandbox**; nunca lo uses en una cuenta reclamada/producción.

---

## 7. Reutilización a futuro

El código es **100% local y reutilizable**. Para volver a tener el MCP corriendo:

```bash
wrangler logout                                   # estar deslogueado
wrangler deploy --temporary --config wrangler.worker.toml
```

- MCP **stateless** (sin KV): reutilización perfecta, cero cambios. URL nueva, estado vacío.
- MCP **con KV/D1**: recrear el recurso y actualizar el `id` en el config en cada cuenta nueva.
- ¿Necesitas **URL estable o datos que sobrevivan**? Eso ya no es "temporal" → **reclama** la
  cuenta y despliega con login normal.

---

## 8. Resumen de las 3 reglas para que un MCP sea apto para cuenta temporal

1. **JavaScript/TypeScript** (Workers es JS/WASM; nada de stdio/Python/filesystem local).
2. **Transport HTTP/SSE remoto** expuesto en el entrypoint del Worker (aquí: `POST /mcp`).
3. **Solo** Workers / Durable Objects / KV / D1 / Queues / Static Assets. Nada de AI, Vectorize,
   R2, Analytics ni dominios propios.

Este Worker cumple las tres.
