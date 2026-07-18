// Rate limiter in-memory, OPT-IN. No se activa solo en ningún lado; lo cablea la app
// que lo quiera vía app.addMiddleware(createRateLimiter({...})). Coherente con el
// resto del núcleo (zero-dependencias, features de infra opt-in como coerce/model).
//
// Diseño: VENTANA DESLIZANTE por clave (sliding window log). Para cada key guardamos
// los timestamps (ms) de las requests aceptadas; en cada llamada podamos los que
// cayeron fuera de windowMs y contamos los restantes. Si >= max, respondemos 429
// y NO llamamos a next(). Ver trade-offs en SPEC4-REPORT.md (vs token bucket).

// Clave por defecto: IP del cliente (req.socket.remoteAddress). Se puede overridear
// con keyFn (p.ej. por token/usuario) para limitar por identidad en vez de por IP.
const DEFAULT_KEY_FN = (req) => (req.socket && req.socket.remoteAddress) || 'unknown';

// Crea un middleware de rate-limiting compatible con app.addMiddleware(fn).
//   createRateLimiter({ windowMs, max, keyFn }) -> (req, res, next) => {}
// Opciones:
//   windowMs  - tamaño de la ventana deslizante en ms (default 60s).
//   max       - máximo de requests por ventana por clave (default 100).
//   keyFn     - (req) => string para agrupar (default: IP). Debe ser determinista.
function createRateLimiter({ windowMs = 60000, max = 100, keyFn = DEFAULT_KEY_FN } = {}) {
    if (typeof keyFn !== 'function') keyFn = DEFAULT_KEY_FN;
    // Map<key, number[]> de timestamps aceptados, en orden creciente.
    const buckets = new Map();

    return function rateLimiter(req, res, next) {
        const now = Date.now();
        const key = keyFn(req);

        let times = buckets.get(key);
        if (!times) { times = []; buckets.set(key, times); }

        // Poda los timestamps fuera de la ventana. Como se insertan en orden,
        // los viejos están al frente: shift hasta encontrar uno dentro.
        const cutoff = now - windowMs;
        while (times.length && times[0] <= cutoff) times.shift();

        if (times.length >= max) {
            // Limite excedido: 429 sin llamar a next().
            if (!res.writableEnded && !res.headersSent) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ detail: 'Too Many Requests' }));
            }
            return;
        }

        times.push(now);
        // Devolvemos la promesa de next() para que el framework la await-e
        // (coherente con el middleware de logging de index.js que hace await next()).
        return next();
    };
}

module.exports = { createRateLimiter, DEFAULT_KEY_FN };