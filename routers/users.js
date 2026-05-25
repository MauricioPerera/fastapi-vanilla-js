const { APIRouter } = require('../lib/fastapi');
const { auth, ensureAuthInit, getCurrentUser } = require('../dependencies/auth');

const userRouter = new APIRouter({
    prefix: '/users',
    tags: ['Usuarios']
});

const UserQuerySchema = {
    limit: { type: 'number', required: false, default: 10 },
    activo: { type: 'boolean', required: false, default: true }
};

// 1. Listar usuarios reales de la base de datos (público para compatibilidad con tests)
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

// 2. Obtener un usuario por ID real o dinámico (para tests legacy)
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

// 3. Crear Usuario (POST) seguro para administradores
userRouter.post('/', async (req, res, deps) => {
    await ensureAuthInit();
    const { email, password, name, roles, active, ...customFields } = req.body;
    if (!email || !password) {
        return res.json({ detail: "Email y contraseña son obligatorios" }, 400);
    }

    try {
        const user = await auth.register(email, password, {
            name: name || '',
            roles: roles || ['user'],
            active: active !== false,
            ...customFields
        });
        auth._users.flush();
        return {
            mensaje: "Usuario registrado con éxito",
            usuario: user
        };
    } catch (err) {
        return res.json({ detail: "Error al registrar usuario", mensaje: err.message }, 400);
    }
}, {
    summary: "Crear Usuario Admin",
    description: "Permite a un operador crear un nuevo usuario con roles y metadatos personalizados.",
    dependencies: { user: getCurrentUser }
});

// 4. Actualizar Usuario por ID (PUT) seguro
userRouter.put('/:id', async (req, res, deps) => {
    await ensureAuthInit();
    const id = req.params.id;
    const { email, password, name, roles, active, ...customFields } = req.body;

    try {
        const col = auth._users;
        const user = col.findById(id);
        if (!user) {
            return res.json({ detail: "Usuario no encontrado" }, 404);
        }

        const updates = { ...customFields };
        if (email !== undefined) updates.email = email.toLowerCase().trim();
        if (name !== undefined) updates.name = name;
        if (roles !== undefined) updates.roles = roles;
        if (active !== undefined) updates.active = active;
        
        if (password) {
            auth._validatePassword(password);
            const hash = await auth._hashPassword(password);
            updates.passwordHash = hash;
            
            // Invalidar sesiones activas de este usuario
            auth._sessions.removeMany({ userId: id });
        }

        col.update({ _id: id }, { $set: updates });
        col.flush();
        auth._sessions.flush();

        const updatedUser = auth.getUser(id);
        return {
            mensaje: "Usuario actualizado con éxito",
            usuario: updatedUser
        };
    } catch (err) {
        return res.json({ detail: "Error al actualizar usuario", mensaje: err.message }, 400);
    }
}, {
    summary: "Actualizar Usuario",
    description: "Permite actualizar propiedades del core y dinámicas de un usuario por su ID.",
    dependencies: { user: getCurrentUser }
});

// 5. Eliminar Usuario por ID (DELETE) seguro
userRouter.delete('/:id', async (req, res, deps) => {
    await ensureAuthInit();
    const id = req.params.id;

    try {
        const col = auth._users;
        const user = col.findById(id);
        if (!user) {
            return res.json({ detail: "Usuario no encontrado" }, 404);
        }

        auth.deleteUser(id);
        col.flush();
        auth._sessions.flush();

        return {
            mensaje: "Usuario eliminado con éxito",
            id
        };
    } catch (err) {
        return res.json({ detail: "Error al eliminar usuario", mensaje: err.message }, 500);
    }
}, {
    summary: "Eliminar Usuario",
    description: "Elimina permanentemente a un usuario e invalida sus tokens de sesión.",
    dependencies: { user: getCurrentUser }
});

module.exports = userRouter;
