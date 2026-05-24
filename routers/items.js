const { APIRouter } = require('../lib/fastapi');
const { ItemBodySchema } = require('../schemas/item.schema');
const { getCurrentUser } = require('../dependencies/auth');
const db = require('../dependencies/db');

const itemRouter = new APIRouter({
    prefix: '/items',
    tags: ['Ítems'],
    dependencies: { user: getCurrentUser } // Obliga a que todas las rutas requieran Auth
});

// Crear ítem (POST) seguro con validación de body y persistencia real
itemRouter.post('/', (req, res, deps) => {
    const col = db.collection('items');
    
    // Insertar el nuevo ítem en la colección
    const inserted = col.insert({
        nombre: req.body.nombre,
        precio: req.body.precio,
        en_oferta: req.body.en_oferta || false,
        usuario_creador: deps.user.email,
        creado_en: Date.now()
    });
    
    // Persiste en caliente al disco duro (.data/items.docs.json)
    try {
        col.flush();
    } catch (err) {
        return res.json({ detail: "Error al persistir el ítem", mensaje: err.message }, 500);
    }
    
    return {
        mensaje: "Ítem guardado con éxito",
        usuario_autor: deps.user,
        item: inserted
    };
}, {
    summary: "Crear Ítem",
    description: "Crea un ítem validando el cuerpo de la petición y el token de seguridad del usuario.",
    body: ItemBodySchema
});

// Listar ítems (GET) seguro desde la colección de la base de datos
itemRouter.get('/', (req, res, deps) => {
    const col = db.collection('items');
    const items = col.find({}).toArray();
    
    // Si la base de datos no tiene ítems, retornamos un listado descriptivo por defecto
    const dataList = items.length > 0 ? items : [
        { _id: "item-default-1", nombre: "Laptop", precio: 1200, en_oferta: false },
        { _id: "item-default-2", nombre: "Mouse", precio: 25, en_oferta: true }
    ];

    return {
        mensaje: "Listado de ítems obtenido en canal seguro",
        usuario: deps.user,
        items: dataList
    };
}, {
    summary: "Listar Ítems",
    description: "Obtiene los ítems del inventario tras validar el token Bearer."
});

module.exports = itemRouter;
