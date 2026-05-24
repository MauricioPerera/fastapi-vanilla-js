process.env.PORT = '8999';
const test = require('node:test');
const assert = require('node:assert');

// Esperar un breve momento para garantizar que el servidor principal en index.js se haya inicializado por completo en el puerto 8999
const BASE_URL = 'http://localhost:8999';
const app = require('./index');

test('FastAPI Vanilla JS Integration Suite', async (t) => {
    
    // Test 1: Endpoint raíz
    await t.test('GET / - Retorna mensaje de bienvenida e índices de endpoints', async () => {
        const res = await fetch(`${BASE_URL}/`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('content-type'), 'application/json');
        
        const data = await res.json();
        assert.ok(data.mensaje.includes("FastAPI Vanilla JS"));
        assert.strictEqual(data.documentacion, '/docs');
    });

    // Test 2: OpenAPI Schema
    await t.test('GET /openapi.json - Entrega esquema OpenAPI 3.0 válido', async () => {
        const res = await fetch(`${BASE_URL}/openapi.json`);
        assert.strictEqual(res.status, 200);
        
        const schema = await res.json();
        assert.strictEqual(schema.openapi, '3.0.0');
        assert.ok(schema.paths['/users']);
        assert.ok(schema.paths['/items']);
    });

    // Test 3: Enrutador de Usuarios con Query por defecto
    await t.test('GET /users - Recupera listado con filtros query por defecto', async () => {
        const res = await fetch(`${BASE_URL}/users`);
        assert.strictEqual(res.status, 200);
        
        const body = await res.json();
        assert.strictEqual(body.filtros.limit, 10);
        assert.strictEqual(body.filtros.activo, true);
        assert.strictEqual(body.data.length, 2);
    });

    // Test 4: Extracción de parámetros dinámicos de ruta
    await t.test('GET /users/:id - Extrae el id de ruta correctamente', async () => {
        const res = await fetch(`${BASE_URL}/users/42`);
        assert.strictEqual(res.status, 200);
        
        const body = await res.json();
        assert.strictEqual(body.id, 42);
        assert.strictEqual(body.name, 'Usuario 42');
    });

    // Test 5: Servidor de archivos estáticos nativo
    await t.test('GET /static/index.html - Sirve archivo HTML físico', async () => {
        const res = await fetch(`${BASE_URL}/static/index.html`);
        assert.strictEqual(res.status, 200);
        assert.ok(res.headers.get('content-type').includes('text/html'));
        
        const text = await res.text();
        assert.ok(text.includes('Servidor de Archivos Estáticos Nativo'));
    });

    // Test 6: Seguridad - Bloqueo de peticiones sin token Bearer
    await t.test('GET /items - Bloquea petición no autenticada con 401', async () => {
        const res = await fetch(`${BASE_URL}/items`);
        assert.strictEqual(res.status, 401);
        
        const body = await res.json();
        assert.strictEqual(body.detail, "No autorizado. Se requiere Token Bearer.");
    });

    // Test 7: Seguridad - Acceso permitido con token Bearer correcto
    await t.test('GET /items - Acceso exitoso con cabecera de autenticación válida', async () => {
        const res = await fetch(`${BASE_URL}/items`, {
            headers: {
                'Authorization': 'Bearer super-secret-token'
            }
        });
        assert.strictEqual(res.status, 200);
        
        const body = await res.json();
        assert.ok(body.mensaje.includes("seguro"));
        assert.strictEqual(body.usuario.username, "admin_user");
        assert.strictEqual(body.items.length, 2);
    });

    // Test 8: Validación de Cuerpo - Falla si faltan campos obligatorios
    await t.test('POST /items - Falla con 400 por campos obligatorios faltantes', async () => {
        const res = await fetch(`${BASE_URL}/items`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer super-secret-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                precio: 50 // falta campo 'nombre'
            })
        });
        assert.strictEqual(res.status, 400);
        
        const body = await res.json();
        assert.strictEqual(body.detail, "Error de validación en cuerpo (body)");
        assert.ok(body.errors.some(e => e.includes("'nombre' es obligatorio")));
    });

    // Test 9: Flujo completo exitoso - Creación de recurso seguro y validado
    await t.test('POST /items - Crea ítem correctamente con datos válidos', async () => {
        const payload = {
            nombre: "Teclado Mecánico",
            precio: 85,
            en_oferta: true
        };
        const res = await fetch(`${BASE_URL}/items`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer super-secret-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        assert.strictEqual(res.status, 200);
        
        const body = await res.json();
        assert.strictEqual(body.mensaje, "Ítem guardado con éxito");
        assert.strictEqual(body.item.nombre, "Teclado Mecánico");
        assert.strictEqual(body.item.precio, 85);
        assert.strictEqual(body.item.en_oferta, true);
    });

    // Test finalización: Cerrar el servidor activo de index.js para que el proceso de tests finalice limpiamente
    t.after(() => {
        const app = require('./index');
        if (app.server) {
            app.server.close();
        }
    });
});
