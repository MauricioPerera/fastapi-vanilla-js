# FastAPI & FastMCP Vanilla JS (Toolkit Híbrido)

[![Tests](https://github.com/MauricioPerera/fastapi-vanilla-js/actions/workflows/tests.yml/badge.svg)](https://github.com/MauricioPerera/fastapi-vanilla-js/actions/workflows/tests.yml)

Una reinterpretación **Clean Room** y unificada de las arquitecturas declarativas de **FastAPI** y **FastMCP** (PrefectHQ) implementadas en **Vanilla JavaScript** con **cero dependencias externas**.

Este toolkit híbrido te permite escribir microservicios de alto rendimiento que funcionan simultáneamente como:
1.  **REST API local (Node.js)**: Servidor HTTP nativo con routers modulares y archivos estáticos.
2.  **Edge Serverless API (Cloudflare)**: Compatible con el motor V8 de Cloudflare Workers y Pages Functions.
3.  **Model Context Protocol Server (Stdio & SSE)**: Servidor de Inteligencia Artificial compatible con Claude Desktop para inyectar herramientas, recursos y plantillas locales.

---

## ✨ Características Principales

*   **Cero Dependencias (`0 node_modules`)**: 100% auditable, inmune a ataques de la cadena de suministro y huella de memoria ínfima (~15MB-30MB).
*   **APIRouter Modular**: Divide tu aplicación en subcontroladores limpios con herencia de prefijos, dependencias comunes y etiquetas OpenAPI.
*   **Validación de Esquemas (Pydantic-like)**: Motor ligero de validación y coerción automática de tipos de datos en parámetros Query y Body.
*   **Validación tipada, coerción y `response_model`**: Opciones de ruta `model` (validación recursiva de objetos anidados, arrays y constraints, con errores estructurados por ruta de campo y respuesta `422`), `coerce` (coerción de tipos estilo Pydantic antes de validar, p. ej. `"30"`→`30`) y `responseModel` (proyecta la respuesta a solo los campos declarados, sin exponer datos sensibles). Disponibles en Node y Edge. Núcleo (`validate`/`serialize`/`coerce`) implementado y verificado con el gate determinista CCDD (ver `ccdd/`).
*   **Inyección de Dependencias Asíncrona (`Depends`)**: Lógica declarativa para autenticación de seguridad, logs y orquestación de servicios.
*   **Swagger UI y OpenAPI Nativo**: Generación dinámica en tiempo de ejecución de especificaciones OpenAPI 3.0.0 y servicio de Swagger UI en `/docs` desde CDN.
*   **Conectividad MCP Dual**:
    *   **Transporte STDIO**: Intercambio JSON-RPC 2.0 delimitado por saltos de línea (`\n`) para subprocesos locales con logs seguros a `stderr`.
    *   **Transporte SSE (Server-Sent Events)**: Servidor de red en caliente que mapea eventos continuos del servidor y peticiones HTTP `POST` bajo el mismo puerto.
*   **Servidor de Estáticos Nativo**: Carga asíncrona segura contra vulnerabilidades de *Directory Traversal*.

### Validación tipada y `response_model` (uso)

Las opciones `model`, `coerce` y `responseModel` se declaran por ruta (funcionan igual en Node y Edge):

```js
app.post('/signup', (req) => {
    // req.body ya validado (y coercionado si coerce:true)
    return { id: 1, email: req.body.email, password: req.body.password };
}, {
    coerce: true,                       // "30" -> 30 antes de validar
    model: {                            // valida el body; body inválido -> 422 con errores por ruta
        type: 'object',
        properties: {
            email: { type: 'string', required: true, minLength: 3 },
            age:   { type: 'integer', minimum: 0 },
            address: { type: 'object', properties: { city: { type: 'string', required: true } } }
        }
    },
    responseModel: {                    // la respuesta solo expone id y email (password se excluye)
        type: 'object',
        properties: { id: { type: 'integer' }, email: { type: 'string' } }
    }
});
```

Un body inválido responde `422` con `{ detail, errors: [{ path, message }] }`, p. ej. `path: "address.city"`.

---

## 📂 Estructura del Proyecto

```text
├── package.json             # Configuración NPM y scripts del toolkit.
├── Dockerfile               # Empaquetado ligero para producción Node.js.
├── index.js                 # Entrada principal del Servidor local Node.js (REST + MCP SSE).
├── worker.js                # Entrada principal (ESM) para Cloudflare Workers.
├── mcp.js                   # Entrada principal del Servidor MCP local (stdio).
├── client.js                # Cliente de pruebas interactivo para el MCP local (stdio).
├── client-sse.js            # Cliente de pruebas interactivo para el MCP de red (SSE/HTTP).
├── run-all-tests.js         # Orquestador unificado de las baterías de pruebas.
├── test.js                  # Suite de pruebas nativas para el Servidor REST local.
├── test-edge.js             # Suite de pruebas nativas para el Edge Worker.
├── test-mcp.js              # Suite de pruebas nativas para el Servidor MCP (stdio).
├── lib/
│   ├── fastapi.js           # Núcleo del microframework API para Node.js.
│   ├── fastapi-edge.js      # Núcleo del microframework API para el Edge.
│   ├── validation.js        # Motor de validación tipada + coerción + response_model (verificado con gate CCDD).
│   ├── fastmcp.js           # Núcleo del microframework Model Context Protocol (stdio/SSE).
│   ├── mcp-features.js      # Registro de recursos, herramientas y prompts del sistema MCP.
│   ├── mcp-fastapi-bridge.js# Traduce rutas REST a herramientas MCP nativas (llamada en proceso).
│   ├── js-doc-store.js      # Document store estilo MongoDB (queries, índices, aggregation).
│   └── js-vector-store.js   # Vector store (Float32/Int8/Binary/Polar, IVF K-means, híbrido BM25).
├── schemas/
│   └── item.schema.js       # Esquemas de validación de datos.
├── dependencies/
│   ├── auth.js              # Resolvedor de inyección de dependencias de seguridad (JWT + bypass dev).
│   ├── db.js                # Instancia del Document Store persistente.
│   └── vector.js            # Instancia del Vector Store y utilidades de cifrado.
├── routers/
│   ├── users.js             # Enrutador modular de /users.
│   ├── items.js             # Enrutador modular seguro de /items.
│   ├── cpts.js              # Enrutador de tipos de contenido dinámicos (CPT) y esquemas.
│   ├── vectors.js           # Enrutador del motor vectorial (/vectors).
│   └── chat.js              # Enrutador de chat/streaming.
├── functions/
│   └── [[path]].js          # Enrutador comodín para Cloudflare Pages Functions.
├── ccdd/                    # Artefactos CCDD: task-contracts + property-tests congelados.
│   ├── validation/          # Contrato/tests de validate + integración del pipeline.
│   ├── serialize/           # Contrato/tests de response_model (serialize).
│   └── coerce/              # Contrato/tests de coerción de tipos.
└── .github/
    └── workflows/
        └── tests.yml        # CI: batería de pruebas en GitHub Actions (Node 20 y 22).
```

---

## 🚀 Guía de Inicio Rápido

### A. Servidor de Producción Local (REST API & MCP SSE)
Inicia el servidor híbrido que levanta la API REST tradicional y el canal de red MCP SSE en el mismo puerto (8000):
```bash
npm start
```
*   **Swagger UI**: `http://localhost:8000/docs`
*   **Esquema OpenAPI**: `http://localhost:8000/openapi.json`
*   **Estáticos Locales**: `http://localhost:8000/static/index.html`
*   **Streaming SSE (MCP)**: `http://localhost:8000/sse`

---

### B. Servidor MCP Local por Stdio (Claude Desktop)
Para que clientes de IA ejecuten el servidor localmente como subproceso stdio:
```bash
npm run mcp
```
Para integrarlo directamente en tu cliente de **Claude Desktop**:
1. Abre `%APPDATA%\Claude\claude_desktop_config.json`.
2. Agrega el servidor en `"mcpServers"` configurando la ruta absoluta a tu archivo:
```json
{
  "mcpServers": {
    "api-mcp-toolkit": {
      "command": "node",
      "args": ["/ruta/absoluta/a/fastapi-vanilla-js/mcp.js"]
    }
  }
}
```

---

### C. Despliegue en Cloudflare Pages
1.  **Crear el proyecto en tu cuenta de Cloudflare**:
    ```bash
    npx wrangler pages project create fastapi-vanilla-js --production-branch master
    ```
2.  **Compilar y Desplegar**:
    Wrangler empaquetará el directorio estático `public/` y compilará dinámicamente tu API comodín de `/functions` a velocidad Edge:
    ```bash
    npx wrangler pages deploy public --project-name=fastapi-vanilla-js --branch=master --commit-dirty=true
    ```
    *Enlace de producción asignado*: `https://fastapi-vanilla-js.pages.dev`

---

## 📊 Ejecución de Pruebas y Clientes Interactivos

El toolkit incluye baterías completas de pruebas automatizadas nativas y clientes locales interactivos para verificar cada componente de red de forma local.

### 1. Batería Completa de Tests
Ejecuta las **88 pruebas nativas** de forma secuencial:
```bash
npm test
```
*   **Suite Node.js** (`test.js`): 23/23 aprobados.
*   **Suite Edge Cloudflare** (`test-edge.js`): 19/19 aprobados.
*   **Suite FastMCP Server** (`test-mcp.js`): 12/12 aprobados.
*   **Suite Validación CCDD** (`ccdd/`): 34/34 aprobados — `validate`/`serialize`/`coerce` (property-tests congelados) + integración del pipeline (`model`/`responseModel`/`coerce`) en Node y Edge.

> Estas mismas baterías se ejecutan automáticamente en **CI (GitHub Actions)** sobre Node 20 y 22 en cada push a `master` y en cada Pull Request (`.github/workflows/tests.yml`). El runner devuelve código de salida `1` ante cualquier fallo, por lo que un PR roto queda en rojo.

### 2. Clientes Interactivos de Prueba
*   **Cliente Local Stdio**: Simula el intercambio de tramas JSON-RPC línea a línea tal y como lo haría Claude Desktop:
    ```bash
    npm run mcp:client
    ```
*   **Cliente de Red SSE**: Abre un canal de eventos en caliente sobre HTTP y envía peticiones `POST` simulando transacciones remotas:
    ```bash
    npm run mcp:client:sse
    ```

---

## 🔒 Seguridad y Buenas Prácticas

*   **Evita el uso de Dependencias**: Mantén el proyecto 100% auditable para eliminar vulnerabilidades heredadas.
*   **Directory Traversal**: Los servidores de archivos estáticos (`serveStatic`) y las herramientas de guardado de logs (`guardar_log`) utilizan `path.resolve` y verificación de pertenencia para impedir el escape de directorios locales.
*   **Logs y STDERR**: Toda la telemetría del servidor MCP se dirige a `stderr`, manteniendo el canal `stdout` exclusivamente reservado para las tramas JSON-RPC 2.0.

### Autenticación y configuración de producción

El resolvedor `getCurrentUser` (`dependencies/auth.js`) valida JWT firmados con Web Crypto. Su comportamiento depende del entorno:

| Variable | Desarrollo (por defecto) | Producción (`NODE_ENV=production`) |
| --- | --- | --- |
| **Secreto de firma JWT** | Usa `dev-insecure-jwt-secret` si no defines `API_SECRET_TOKEN`. | **`API_SECRET_TOKEN` es obligatorio**: el arranque falla (throw) si no está definido. |
| **Bypass de desarrollo** | El token `Bearer super-secret-token` concede rol `administrator` (para los tests). | **Deshabilitado**. Solo se aceptan JWT válidos. |

> ⚠️ **Antes de desplegar**: define `API_SECRET_TOKEN` con un valor secreto y único, y ejecuta con `NODE_ENV=production`. Así se desactiva el bypass de desarrollo y se garantiza que la firma JWT no use un secreto público conocido.

*   **Llamadas internas de confianza (MCP bridge)**: `mcp-fastapi-bridge.js` invoca los handlers REST en proceso inyectando un principal de confianza vía `req.internalAuth`. Esta propiedad **no es alcanzable desde la red** (las peticiones HTTP solo aportan cabeceras), por lo que no constituye un bypass explotable externamente.
