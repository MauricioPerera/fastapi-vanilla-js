# Desplegar un Worker vía el MCP de Cloudflare (sin Wrangler ni login)

Este documento recoge lo aprendido al desplegar el servidor MCP de este repo a una cuenta
**real** de Cloudflare usando **únicamente el servidor MCP oficial de Cloudflare** (la API),
con `wrangler` **deslogueado**. Complementa a
[`cuentas-temporales-cloudflare.md`](cuentas-temporales-cloudflare.md).

> TL;DR: **Sí se puede** desplegar un Worker sin Wrangler ni login, llamando a la API de
> Cloudflare desde el MCP. Funciona perfecto para **Workers pequeños/self-contained**. El
> límite real **no es el permiso**, sino que el sandbox del MCP **no tiene salida a Internet**:
> el código debe ir *inline* en la llamada, así que un bundle grande (cientos de KB) no es viable
> por esta vía.

---

## 1. Hallazgo central: la auth del MCP es independiente de Wrangler

`wrangler logout` cierra la sesión **del CLI**, pero **no afecta al MCP de Cloudflare**: el MCP
usa su propio token, ligado a tu cuenta. Verificado en vivo: con Wrangler deslogueado, el MCP
seguía leyendo la cuenta real y, finalmente, **escribiendo** un Worker en ella.

| Sistema | Credencial | Afectado por `wrangler logout` |
|---|---|---|
| Wrangler CLI | OAuth / `CLOUDFLARE_API_TOKEN` | ✅ Sí |
| MCP de Cloudflare | Token propio del servidor MCP | ❌ No |

**Implicación de seguridad:** desloguear Wrangler **no** revoca el acceso del MCP. Si quieres
cortar de verdad el acceso programático, hay que revocar/gestionar el token del MCP aparte.

---

## 2. Cómo se despliega un Worker por la API (lo que hace Wrangler por dentro)

Dos llamadas a la API de Cloudflare:

1. **Subir el script** (Worker ESM = módulos en `multipart/form-data`):
   ```
   PUT /accounts/{account_id}/workers/scripts/{name}
   Content-Type: multipart/form-data; boundary=...
   ```
   - Parte `metadata` (JSON): `{ "main_module": "worker.js", "compatibility_date": "...", "bindings": [...] }`
   - Una parte por cada módulo: `Content-Type: application/javascript+module`, con `name`/`filename`
     igual a la **ruta del módulo** (p.ej. `worker.js`, `lib/fastmcp-edge.js`). Los imports relativos
     (`./lib/x.js`) se resuelven contra esos nombres, así que **no hace falta bundler**.

2. **Habilitar la URL pública** `*.workers.dev`:
   ```
   POST /accounts/{account_id}/workers/scripts/{name}/subdomain
   { "enabled": true }
   ```
   El subdominio de la cuenta se consulta en `GET /accounts/{id}/workers/subdomain`
   (en nuestra prueba: `rckflr` → `https://{name}.rckflr.workers.dev`).

**Limpieza:** `DELETE /accounts/{account_id}/workers/scripts/{name}`.

### Esqueleto con el MCP (`execute`)

```js
async () => {
  const script = atob(B64_DEL_WORKER);            // ver §3: el código va inline
  const meta = { main_module: "worker.js", compatibility_date: "2025-06-01", bindings: [] };
  const b = "----boundary", CRLF = "\r\n";
  const body =
    `--${b}${CRLF}Content-Disposition: form-data; name="metadata"${CRLF}` +
    `Content-Type: application/json${CRLF}${CRLF}${JSON.stringify(meta)}${CRLF}` +
    `--${b}${CRLF}Content-Disposition: form-data; name="worker.js"; filename="worker.js"${CRLF}` +
    `Content-Type: application/javascript+module${CRLF}${CRLF}${script}${CRLF}--${b}--${CRLF}`;
  const put = await cloudflare.request({
    method: "PUT", path: `/accounts/${accountId}/workers/scripts/mi-worker`,
    body, contentType: `multipart/form-data; boundary=${b}`, rawBody: true,
  });
  await cloudflare.request({ method: "POST",
    path: `/accounts/${accountId}/workers/scripts/mi-worker/subdomain`, body: { enabled: true } });
  return put.success;
}
```

---

## 3. La limitación real: el sandbox del MCP no tiene egress

El `execute` del MCP **solo puede llamar a `api.cloudflare.com`**. Todo intento de descargar el
código desde fuera fue rechazado:

| Host | Resultado |
|---|---|
| `raw.githubusercontent.com` | `403 Forbidden: requests to raw.githubusercontent.com are not allowed` |
| `github.com` (`/raw/`) | `403 ... not allowed` |
| `api.github.com` (contents API) | `403 ... not allowed` |
| `cdn.jsdelivr.net` | `403` |

**Consecuencia:** el código del Worker **debe viajar dentro de la propia llamada** al MCP
(inline, normalmente en base64 + `atob`). No se puede "que el sandbox lo baje".

### Qué entra y qué no por esta vía

| Caso | ¿Viable por MCP? | Por qué |
|---|:---:|---|
| Worker **slim / self-contained** (un archivo, pocos KB) | ✅ | El base64 cabe inline en la llamada. |
| Worker **multi-módulo pequeño** | ✅ | Se inlinan varias partes pequeñas. |
| App **completa bundleada** (este repo: ~260 KB / ~346 KB en base64) | ❌ (no práctico) | Demasiado grande para inlinear en una sola llamada; el sandbox no puede descargarla. |

**Resultado de la prueba:** se desplegó la versión **slim** del MCP (4 tools, self-contained,
~5 KB) a la cuenta real y respondió el handshake + `tools/call` en
`https://fastapi-vanilla-js-mcp.rckflr.workers.dev/mcp`. El Worker **completo** del repo no se
pudo subir por el MCP por el tamaño.

---

## 4. Permisos del token del MCP (verificado)

- **Lectura de Workers:** OK (`GET /workers/scripts` → 200, listó 50 scripts).
- **Escritura de Workers:** OK (`PUT .../scripts/{name}` → 200). El grupo de permisos de Workers
  concede lectura **y** edición juntas.
- **Subdominio:** OK (`POST .../subdomain` → 200).

> No asumas que "el MCP está conectado" implica escritura: hasta hacer el `PUT` solo habíamos
> confirmado lecturas. La única forma 100% segura de saber si hay permiso de escritura es intentar
> la operación.

---

## 5. Cuándo usar cada vía

| Necesitas… | Usa |
|---|---|
| Desplegar **sin login**, Worker pequeño, o deploy programático desde un agente | **MCP / API** (esta guía) |
| Desplegar la **app completa** (multi-módulo grande, bundling, bindings complejos) | **Wrangler** (`wrangler deploy`) o **cuenta temporal** (`--temporary`) |
| Un **sandbox efímero** sin tocar tu cuenta | **Cuenta temporal** (ver la otra guía) |

---

## 6. Resumen de lecciones

1. **Auth desacoplada:** `wrangler logout` no desconecta el MCP de Cloudflare; son credenciales
   distintas. Revisa esto al razonar sobre seguridad/acceso.
2. **Wrangler es opcional para desplegar:** un `PUT` multipart a `/workers/scripts/{name}` +
   habilitar subdominio replica lo que hace `wrangler deploy`. Los Workers ESM se suben como
   módulos, **sin bundler**.
3. **El cuello de botella es el egress, no el permiso:** el sandbox del MCP solo habla con la API
   de Cloudflare; el código debe ir inline → solo entran Workers pequeños por esta vía.
4. **Confirma escritura con el intento real:** acceso de lectura no implica escritura.
5. **Limpieza fácil:** `DELETE /workers/scripts/{name}` borra el despliegue.
