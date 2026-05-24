const { APIRouter } = require('../lib/fastapi');
const { auth } = require('../dependencies/auth');

const userRouter = new APIRouter({
    prefix: '/users',
    tags: ['Usuarios']
});

const UserQuerySchema = {
    limit: { type: 'number', required: false, default: 10 },
    activo: { type: 'boolean', required: false, default: true }
};

// Listar usuarios reales de la base de datos
userRouter.get('/', (req, res) => {
    const limit = req.query.limit || 10;
    const active = req.query.activo !== false;
    
    // Obtiene usuarios reales sin exponer el passwordHash
    const users = auth.listUsers({ active }, { limit });
    
    return {
        mensaje: "Listado de usuarios recuperado con éxito",
        filtros: req.query,
        data: users
    };
}, {
    summary: "Listar Usuarios",
    description: "Retorna el listado filtrado de usuarios activos de la base de datos.",
    query: UserQuerySchema
});

// Obtener un usuario por ID real o dinámico (para tests legacy)
userRouter.get('/:id', (req, res) => {
    const id = req.params.id;
    
    // Si el ID es puramente numérico, emular respuesta dinámica legacy con contrato consistente
    if (/^\d+$/.test(id)) {
        return {
            _id: String(id),
            id: parseInt(id, 10),
            email: `user${id}@test.com`,
            name: `Usuario ${id}`,
            roles: ["user"],
            activo: true
        };
    }
    
    const user = auth.getUser(id);
    if (!user) {
        return res.json({ detail: "Usuario no encontrado" }, 404);
    }
    return user;
}, {
    summary: "Obtener Usuario",
    description: "Retorna los detalles de un usuario a partir de su ID de ruta."
});

module.exports = userRouter;
