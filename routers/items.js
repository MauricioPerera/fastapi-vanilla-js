const { APIRouter } = require('../lib/fastapi');
const { getCurrentUser } = require('../dependencies/auth');
const db = require('../dependencies/db');
const { Table } = require('../lib/js-doc-store');

const itemRouter = new APIRouter({
    prefix: '/items',
    tags: ['Ítems'],
    dependencies: { user: getCurrentUser } // Enforce authentication for all endpoints
});

// Crear ítem (POST) seguro validando con el esquema dinámico de CPT items
itemRouter.post('/', (req, res, deps) => {
    try {
        const schemaCol = db.collection('_cpt_schemas');
        const schemaDoc = schemaCol.findById('items') || {
            columns: [
                { name: 'nombre', type: 'text', required: true },
                { name: 'precio', type: 'number', required: true },
                { name: 'en_oferta', type: 'checkbox', required: false }
            ]
        };

        const table = new Table(db, 'items', { columns: schemaDoc.columns });
        const col = db.collection('items');

        const defaultedDoc = table._applyDefaults(req.body);
        table._validate(defaultedDoc);

        const inserted = col.insert({
            ...defaultedDoc,
            usuario_creador: deps.user.email,
            creado_en: Date.now()
        });

        col.flush();

        return {
            mensaje: "Ítem guardado con éxito",
            usuario_autor: deps.user,
            item: inserted
        };
    } catch (err) {
        if (err.message && err.message.includes("Validation failed:")) {
            const validationErrors = err.message.replace("Validation failed:", "").split(";").map(e => e.trim());
            const mappedErrors = validationErrors.map(e => {
                if (e.includes("is required")) {
                    const field = e.split(" ")[0];
                    return `'${field}' es obligatorio`;
                }
                return e;
            });
            return res.json({
                detail: "Error de validación en cuerpo (body)",
                errors: mappedErrors
            }, 400);
        }
        return res.json({ detail: "Error de validación o persistencia", mensaje: err.message }, 400);
    }
}, {
    summary: "Crear Ítem",
    description: "Crea un ítem validando el cuerpo de la petición contra el esquema dinámico del CPT y el token Bearer."
});

// Listar ítems (GET) seguro desde la colección CPT items
itemRouter.get('/', (req, res, deps) => {
    try {
        const col = db.collection('items');
        const items = col.find({}).toArray();
        
        // Si no hay registros, mantener retrocompatibilidad con items descriptivos por defecto
        const dataList = items.length > 0 ? items : [
            { _id: "item-default-1", nombre: "Laptop", precio: 1200, en_oferta: false },
            { _id: "item-default-2", nombre: "Mouse", precio: 25, en_oferta: true }
        ];

        return {
            mensaje: "Listado de ítems obtenido en canal seguro",
            usuario: deps.user,
            items: dataList
        };
    } catch (err) {
        return res.json({ detail: "Error al listar ítems", mensaje: err.message }, 500);
    }
}, {
    summary: "Listar Ítems",
    description: "Obtiene los ítems del inventario tras validar el token Bearer."
});

module.exports = itemRouter;
