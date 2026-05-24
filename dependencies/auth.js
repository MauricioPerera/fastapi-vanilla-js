class UnauthorizedError extends Error {
    constructor(message) {
        super(message);
        this.name = "UnauthorizedError";
    }
}

const getCurrentUser = async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.json({ detail: "No autorizado. Se requiere Token Bearer." }, 401);
        throw new UnauthorizedError("Token no provisto o inválido");
    }
    
    const token = authHeader.split(' ')[1];
    // Validación del token con variable de entorno (fallback seguro para desarrollo local)
    const secretToken = process.env.API_SECRET_TOKEN || 'super-secret-token';
    if (token !== secretToken) {
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
    getCurrentUser,
    UnauthorizedError
};
