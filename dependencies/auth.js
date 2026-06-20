const db = require('./db');
const { Auth } = require('../lib/js-doc-store');

// Definir UnauthorizedError localmente para la API
class UnauthorizedError extends Error {
    constructor(message) {
        super(message);
        this.name = "UnauthorizedError";
    }
}

// El bypass de desarrollo y el secreto por defecto SOLO se permiten fuera de producción.
const ALLOW_DEV_BYPASS = process.env.NODE_ENV !== 'production';
const DEV_BYPASS_TOKEN = 'super-secret-token';

// Secreto JWT: obligatorio en producción (falla-cerrado); default inseguro y claramente
// marcado solo en desarrollo. Nunca reutiliza el token de bypass como secreto de firma.
const authSecret = process.env.API_SECRET_TOKEN || (ALLOW_DEV_BYPASS ? 'dev-insecure-jwt-secret' : null);
if (!authSecret) {
    throw new Error("API_SECRET_TOKEN es obligatorio en producción (NODE_ENV=production).");
}
const auth = new Auth(db, {
    secret: authSecret,
    tokenExpiry: 86400 // 24 horas
});

let authInitialized = false;

/**
 * Garantiza que las colecciones e índices de autenticación estén cargados e inicializados.
 */
async function ensureAuthInit() {
    if (!authInitialized) {
        await auth.init();
        authInitialized = true;
    }
}

/**
 * Resolver de FastAPI (Depends) para extraer y verificar el usuario autenticado.
 * Soporta validación de JWT real firmada por Web Crypto y bypass para testing.
 */
const getCurrentUser = async (req, res) => {
    await ensureAuthInit();

    // Inyección de confianza en proceso (p.ej. el bridge MCP). No es alcanzable vía HTTP:
    // las peticiones de red nunca traen esta propiedad, solo cabeceras.
    if (req.internalAuth) {
        return req.internalAuth;
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.json({ detail: "No autorizado. Se requiere Token Bearer." }, 401);
        throw new UnauthorizedError("Token no provisto o inválido");
    }

    const token = authHeader.split(' ')[1];

    // Bypass de desarrollo para tests retrocompatibles. Deshabilitado en producción.
    if (ALLOW_DEV_BYPASS && token === DEV_BYPASS_TOKEN) {
        return {
            username: "admin_user",
            role: "administrator",
            authenticatedAt: new Date().toISOString()
        };
    }

    // Validación real de JWT criptográfica y sesión activa
    const payload = await auth.verify(token);
    if (!payload) {
        res.json({ detail: "No autorizado. Token incorrecto o expirado." }, 403);
        throw new UnauthorizedError("Acceso prohibido");
    }

    const user = auth.getUser(payload.sub);
    if (!user) {
        res.json({ detail: "Usuario no encontrado." }, 404);
        throw new Error("Usuario no encontrado");
    }

    return user;
};

module.exports = {
    auth,
    ensureAuthInit,
    getCurrentUser,
    UnauthorizedError
};
