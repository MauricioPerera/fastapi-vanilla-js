const { APIRouter } = require('../lib/fastapi');
const { ItemBodySchema } = require('../schemas/item.schema');
const { getCurrectUser } = require('../dependencies/auth');

const itemRouter = new APIRouter({
    prefix: '/items',
    tags: ['Ítems'],
    dependencies: { user: getCurrectUser } // Obliga a que todas las rutas requieran Auth
});

// Crear ítem (POST) seguro con validación de body
itemRouter.post('/', (req, res, deps) => {
    return {
        mensaje: "Ítem guardado con éxito",
        usuario_autor: deps.user,
        item: req.body
    };
}, {
    summary: "Crear Ítem",
    description: "Crea un ítem validando el cuerpo de la petición y el token de seguridad del usuario.",
    body: ItemBodySchema
});

// Listar ítems (GET) seguro
itemRouter.get('/', (req, res, deps) => {
    return {
        mensaje: "Listado de ítems obtenido en canal seguro",
        usuario: deps.user,
        items: [
            { id: 101, nombre: "Laptop", precio: 1200, en_oferta: false },
            { id: 102, nombre: "Mouse", precio: 25, en_oferta: true }
        ]
    };
}, {
    summary: "Listar Ítems",
    description: "Obtiene los ítems del inventario tras validar el token Bearer."
});

module.exports = itemRouter;
