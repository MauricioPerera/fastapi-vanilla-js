# FastAPI Vanilla JS (Híbrido Node.js & Cloudflare Edge)

Una reinterpretación **Clean Room** de la arquitectura y pilares de **FastAPI** implementada en **Vanilla JavaScript** con **cero dependencias externas**.

Este framework híbrido te permite escribir APIs modulares y autodescriptivas que pueden ejecutarse tanto en servidores tradicionales (**Node.js**) como en plataformas perimetrales globales (**Cloudflare Workers / Pages Functions**) con un inicio en frío instantáneo (<1ms).

---

## ✨ Características Principales

*   **Cero Dependencias (`0 node_modules`)**: 100% auditable, libre de riesgos de seguridad en la cadena de suministro y huella de memoria ultra-reducida (~15MB-30MB).
*   **Enrutamiento Dinámico Modular (`APIRouter`)**: Divide tu aplicación en múltiples controladores limpios con herencia de prefijos, dependencias comunes y etiquetas OpenAPI.
*   **Validación de Esquemas Integrada**: Motor ligero de validación y coerción automática de tipos de datos en parámetros Query y Body (Pydantic-like).
*   **Inyección de Dependencias Asíncrona (`Depends`)**: Lógica declarativa para validación de seguridad, conexiones a bases de datos y orquestación de servicios.
*   **Swagger UI y OpenAPI Nativo**: Generación dinámica en tiempo de ejecución del esquema OpenAPI 3.0.0 y servicio interactivo de Swagger UI en `/docs` servido de forma segura desde CDN.
*   **Middlewares y CORS**: Tubería de middlewares asíncronos y soporte CORS nativo flexible.
*   **Servidor de Estáticos**: Capacidad de servir directorios físicos locales de forma asíncrona y segura contra vulnerabilidades de *Directory Traversal*.

---

## 📂 Estructura del Proyecto

```text
├── package.json             # Scripts npm y configuraciones básicas.
├── Dockerfile               # Receta Alpine optimizada para producción Node.js.
├── index.js                 # Entrada principal del servidor local en Node.js.
├── worker.js                # Entrada principal (ESM) para Cloudflare Workers.
├── run-all-tests.js         # Orquestador unificado de batería de pruebas.
├── test.js                  # Suite de pruebas de integración nativas para Node.js.
├── test-edge.js             # Suite de pruebas de integración nativas para Cloudflare.
├── lib/
│   ├── fastapi.js           # Núcleo del framework para Node.js.
│   └── fastapi-edge.js      # Núcleo del framework para V8 Edge.
├── schemas/
│   └── item.schema.js       # Esquemas de validación declarativos.
├── dependencies/
│   └── auth.js              # Resolvedores de inyección de dependencias de seguridad.
└── routers/
    ├── users.js             # Enrutador modular de recursos /users.
    └── items.js             # Enrutador modular seguro para recursos /items.
```

---

## 🚀 Guía de Inicio Rápido (Servidor Node.js)

### 1. Iniciar el Servidor
Ejecuta la API directamente con Node.js en el puerto predeterminado (8000) o asignando la variable de entorno `PORT`:
```bash
node index.js
```

### 2. Endpoints Disponibles
*   **Swagger UI Interactivo**: `http://localhost:8000/docs`
*   **Esquema OpenAPI JSON**: `http://localhost:8000/openapi.json`
*   **Página HTML Estática**: `http://localhost:8000/static/index.html`

---

## ⚡ Guía de Inicio Rápido (Cloudflare Workers / Edge)

La versión Edge utiliza estándares Web (`Request`, `Response`, `URL`) haciéndola compatible con el motor V8 de Cloudflare.

### Ejemplo de Enrutador en el Edge:
```javascript
import { FastAPI, APIRouter } from './lib/fastapi-edge.js';

const app = new FastAPI({ cors: true });
const router = new APIRouter({ prefix: "/products" });

router.get('/', () => {
    return { status: "OK", items: [] };
});

app.includeRouter(router);

export default {
    async fetch(request, env, ctx) {
        return await app.handle(request, env, ctx);
    }
};
```

---

## 📊 Batería de Pruebas Nativa

El proyecto incorpora un cargador secuencial que ejecuta las pruebas automatizadas de ambas arquitecturas (Node y Edge) usando el test runner nativo de Node.js (`node:test`) sin añadir frameworks externos de pruebas.

Para ejecutar la batería completa:
```bash
node run-all-tests.js
```

### Resultados Validados:
1.  **GET /**: 200 OK con índices.
2.  **GET /openapi.json**: Valida esquema OpenAPI 3.0 auto-generado.
3.  **GET /users**: Validación de parámetros Query por defecto.
4.  **GET /users/:id**: Extracción dinámica de ruta.
5.  **GET /static/index.html**: Servicio asíncrono seguro de archivos estáticos.
6.  **GET /items (Bloqueo)**: Retorna 401 si falta Token Bearer.
7.  **GET /items (Acceso)**: 200 OK bajo autenticación exitosa.
8.  **POST /items (Falla)**: Retorna 400 por validación de campos obligatorios faltantes.
9.  **POST /items (Éxito)**: Crea recurso exitosamente.

---

## 🔒 Seguridad y Buenas Prácticas

*   **Evita el uso de Dependencias de Terceros**: Mantén el proyecto 100% limpio auditando únicamente tus líneas locales de código.
*   **Validación Estricta**: Declara siempre tus esquemas en la carpeta `schemas/` para proteger tus endpoints contra payloads corruptos o inyecciones maliciosas de parámetros de entrada.
*   **Directivas CORS**: Configura adecuadamente el objeto `cors` en el constructor de `FastAPI` para restringir los orígenes según el ambiente de despliegue.
