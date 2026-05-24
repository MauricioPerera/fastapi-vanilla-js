class UnauthorizedError extends Error {
    constructor(message) {
        super(message);
        this.name = "UnauthorizedError";
    }
}

const getCurrectUser = async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.json({ detail: "No autorizado. Se requiere Token Bearer." }, 401);
        throw new UnauthorizedError("Token no provisto o inválido");
    }
    
    const token = authHeader.split(' ')[1];
    // Simular validación del token
    if (token !== 'super-secret-token') {
        res.json({ detail: "No autorizado. Token incorrecto." }, 403);
        throw new UnauthorizedError("Acceso prohibido");
    }
    
    return {
        username: "admin_user",
        role: "administrator",
        authenticatedAt: new Date().toISOString()
    };
};

module.exports = {
    getCurrectUser,
    UnauthorizedError
};
