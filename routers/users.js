const { APIRouter } = require('../lib/fastapi');

const userRouter = new APIRouter({
    prefix: '/users',
    tags: ['Usuarios']
});

const UserQuerySchema = {
    limit: { type: 'number', required: false, default: 10 },
    activo: { type: 'boolean', required: false, default: true }
};

// Listar usuarios con validación de query
userRouter.get('/', (req, res) => {
    return {
        mensaje: "Listado de usuarios recuperado con éxito",
        filtros: req.query,
        data: [
            { id: 1, name: "Alice", active: true },
            { id: 2, name: "Bob", active: true }
        ]
    };
}, {
    summary: "Listar Usuarios",
    description: "Retorna el listado filtrado de usuarios activos.",
    query: UserQuerySchema
});

// Obtener un usuario por ID
userRouter.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    return {
        id,
        name: `Usuario ${id}`,
        active: true
    };
}, {
    summary: "Obtener Usuario",
    description: "Retorna los detalles de un usuario a partir de su ID de ruta."
});

module.exports = userRouter;
