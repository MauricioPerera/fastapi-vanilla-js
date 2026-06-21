# Controles de seguridad y coste del endpoint `/mcp`

El servidor MCP del Worker ([`lib/fastmcp-edge.js`](../lib/fastmcp-edge.js)) incluye un guard
opcional para evitar el mal uso de un MCP **público sin auth**. **Todos los controles están
apagados por defecto**: si no defines las variables/bindings, el `/mcp` se comporta como un MCP
abierto (igual que antes). Activas solo lo que necesites.

Aplican en `POST /mcp`, **antes** de procesar el JSON-RPC, en este orden:
**kill switch estático → auth → kill switch KV → rate-limit → tope diario**.

Dos decisiones de diseño:
- **La auth se valida antes de tocar KV** (solo lee env vars). Así la auth no depende de que KV
  esté disponible y el tráfico anónimo **no genera lecturas de KV** (evita amplificación de
  coste/DoS sobre tu namespace).
- Los controles con I/O (KV / rate-limiter) son **fail-open**: si el backend falla de forma
  transitoria, se registra y se deja pasar, para no tumbar el MCP ni devolver un 500. La barrera
  de auth no se relaja porque va antes del bloque con I/O.

> Recordatorio: sobre `*.workers.dev` **no hay WAF/Access del dashboard** (eso requiere dominio
> propio). Por eso estos controles van **en el código del Worker** y se activan por configuración.

---

## 1. Kill switch — apagar el MCP al instante

| Variante | Config | Efecto |
|---|---|---|
| Estática | env var `MCP_DISABLED = "1"` | `503` en todo `POST /mcp` (requiere redeploy para cambiar). |
| Instantánea | binding KV `MCP_KV`, clave `mcp:disabled = "1"` | `503` **sin redeploy** (botón de pánico en caliente). |

```bash
# Apagar en caliente (sin redeploy), si tienes el binding MCP_KV:
wrangler kv key put --binding=MCP_KV mcp:disabled 1 --remote
# Reactivar:
wrangler kv key delete --binding=MCP_KV mcp:disabled --remote
```

## 2. Autenticación Bearer — fuera los anónimos

Define el secreto `MCP_AUTH_TOKEN`. Sin él no se exige auth; con él, todo `POST` necesita
`Authorization: Bearer <token>` (comparación en tiempo casi constante). Si falta o no coincide → `401`.

```bash
wrangler secret put MCP_AUTH_TOKEN        # te pide el valor (no se commitea)
```
```
curl https://<...>.workers.dev/mcp -H "Authorization: Bearer <token>" -d '{...}'
```

## 3. Rate limiting — cortar floods (por token o IP)

Usa el **binding nativo de Workers Rate Limiting** `MCP_RATE_LIMITER`. La clave es el token si
hay auth, si no la IP del edge (`cf-connecting-ip`). Si se supera → `429`.

```toml
# wrangler.toml — limita a 60 peticiones por minuto por cliente
[[unsafe.bindings]]
name = "MCP_RATE_LIMITER"
type = "ratelimit"
namespace_id = "1001"
simple = { limit = 60, period = 60 }
```

## 4. Tope diario — autocap de coste

Con `MCP_KV` (binding KV) + `MCP_DAILY_CAP` (entero), el Worker cuenta peticiones por día y
devuelve `429` al alcanzar el tope. Es tu **límite de gasto real** en Workers Paid (que no tiene
corte automático nativo).

```toml
# wrangler.toml
[[kv_namespaces]]
binding = "MCP_KV"
id = "<id-del-namespace>"

[vars]
MCP_DAILY_CAP = "50000"
```

> KV es eventual y el incremento no es atómico: sirve como **tope de coste aproximado**, no como
> cuota exacta. Para cuota estricta por cliente, usa un Durable Object como contador.

---

## Combo recomendado para un MCP público

| Objetivo | Control | Config |
|---|---|---|
| Solo clientes autorizados | Auth Bearer | `MCP_AUTH_TOKEN` |
| Frenar abuso de un cliente | Rate limit | binding `MCP_RATE_LIMITER` |
| Factura acotada | Tope diario | `MCP_KV` + `MCP_DAILY_CAP` |
| Apagado de emergencia | Kill switch | `MCP_KV` clave `mcp:disabled` |

Con los cuatro: anónimos fuera, floods cortados, coste topado y botón de pánico — **sin dominio
propio**. Y nada cambia si no los configuras.

## Matriz de respuestas

| Situación | HTTP |
|---|---|
| Sin controles configurados | 200 (procesa) |
| `MCP_DISABLED=1` o KV `mcp:disabled=1` | 503 |
| Falta/!= `MCP_AUTH_TOKEN` | 401 |
| Rate limit superado | 429 |
| Tope diario alcanzado | 429 |

Cubierto por la suite [`test-mcp-edge-guard.js`](../test-mcp-edge-guard.js) (11 casos).
