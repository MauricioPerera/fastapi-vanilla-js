const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. CLASE APIRouter (Modularización de Rutas)
// ============================================================================
class APIRouter {
    constructor(options = {}) {
        this.prefix = options.prefix || "";
        this.tags = options.tags || [];
        this.dependencies = options.dependencies || null;
        this.routes = [];
    }

    _pathToRegex(pathStr) {
        // Combina el prefijo y limpia diagonales repetidas
        let fullPath = (this.prefix + pathStr).replace(/\/+/g, '/');
        // Remover barra final para la regex si no es la raíz del sitio, pero hacerla opcional
        if (fullPath.endsWith('/') && fullPath !== '/') {
            fullPath = fullPath.slice(0, -1);
        }
        const keys = [];
        const pattern = fullPath.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
            keys.push(key);
            return '([^/]+)';
        });
        return {
            regex: new RegExp(`^${pattern}(?:\\/)?$`),
            keys,
            fullPath: fullPath || '/'
        };
    }

    _registerRoute(method, pathStr, handler, options = {}) {
        const { regex, keys, fullPath } = this._pathToRegex(pathStr);
        const routeTags = [...new Set([...(this.tags || []), ...(options.tags || [])])];
        const routeDeps = { ...(this.dependencies || {}), ...(options.dependencies || {}) };

        this.routes.push({
            method,
            path: fullPath,
            regex,
            keys,
            handler,
            summary: options.summary || `${method} ${fullPath}`,
            description: options.description || "",
            querySchema: options.query || null,
            bodySchema: options.body || null,
            dependencies: Object.keys(routeDeps).length > 0 ? routeDeps : null,
            tags: routeTags
        });
    }

    get(pathStr, handler, options) { this._registerRoute('GET', pathStr, handler, options); }
    post(pathStr, handler, options) { this._registerRoute('POST', pathStr, handler, options); }
    put(pathStr, handler, options) { this._registerRoute('PUT', pathStr, handler, options); }
    delete(pathStr, handler, options) { this._registerRoute('DELETE', pathStr, handler, options); }
}

// ============================================================================
// 2. CLASE FastAPI (Aplicación Principal)
// ============================================================================
class FastAPI {
    constructor(config = {}) {
        this.title = config.title || "FastAPI Vanilla JS";
        this.version = config.version || "1.0.0";
        this.description = config.description || "Clean room reinterpretation of FastAPI";
        this.routes = [];
        this.middlewares = [];
        this.exceptionHandlers = new Map();
        this.cors = config.cors || null;

        // Manejador de excepciones por defecto
        this.defaultExceptionHandler = (req, res, err) => {
            if (!res.writableEnded && !res.headersSent) {
                res.json({ detail: "Internal Server Error", error: err.message }, 500);
            }
        };
    }

    // Registra un interceptor de red global (Middleware asíncrono)
    addMiddleware(middlewareFunc) {
        this.middlewares.push(middlewareFunc);
    }

    // Registra un manejador de excepciones personalizado
    addExceptionHandler(errorType, handler) {
        this.exceptionHandlers.set(errorType, handler);
    }

    // Incluye las rutas de un router modular
    includeRouter(router) {
        this.routes.push(...router.routes);
    }

    // Atajos de ruteo para la raíz de la aplicación
    _pathToRegex(pathStr) {
        let cleanPath = pathStr;
        if (cleanPath.endsWith('/') && cleanPath !== '/') {
            cleanPath = cleanPath.slice(0, -1);
        }
        const keys = [];
        const pattern = cleanPath.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
            keys.push(key);
            return '([^/]+)';
        });
        return { regex: new RegExp(`^${pattern}(?:\\/)?$`), keys };
    }

    _registerRoute(method, pathStr, handler, options = {}) {
        const { regex, keys } = this._pathToRegex(pathStr);
        this.routes.push({
            method,
            path: pathStr,
            regex,
            keys,
            handler,
            summary: options.summary || `${method} ${pathStr}`,
            description: options.description || "",
            querySchema: options.query || null,
            bodySchema: options.body || null,
            dependencies: options.dependencies || null,
            tags: options.tags || []
        });
    }

    get(pathStr, handler, options) { this._registerRoute('GET', pathStr, handler, options); }
    post(pathStr, handler, options) { this._registerRoute('POST', pathStr, handler, options); }
    put(pathStr, handler, options) { this._registerRoute('PUT', pathStr, handler, options); }
    delete(pathStr, handler, options) { this._registerRoute('DELETE', pathStr, handler, options); }

    // Servidor de archivos estáticos integrado con protección de rutas
    serveStatic(prefix, directoryPath) {
        const cleanPrefix = prefix.replace(/\/$/, ''); 
        const regex = new RegExp(`^${cleanPrefix}(/.*)?$`);

        this.routes.push({
            method: 'GET',
            path: cleanPrefix + '/*',
            regex,
            keys: ['filepath'],
            handler: async (req, res) => {
                const relativePath = req.params.filepath || '/index.html';
                const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
                const filePath = path.join(directoryPath, safePath);
                
                // Evitar vulnerabilidad de Directory Traversal
                if (!filePath.startsWith(path.resolve(directoryPath))) {
                    res.writeHead(403);
                    return res.end("Forbidden");
                }

                try {
                    const stats = await fs.promises.stat(filePath);
                    if (!stats.isFile()) {
                        res.writeHead(404);
                        return res.end("Not Found");
                    }

                    const ext = path.extname(filePath).toLowerCase();
                    const mimeTypes = {
                        '.html': 'text/html',
                        '.css': 'text/css',
                        '.js': 'text/javascript',
                        '.json': 'application/json',
                        '.png': 'image/png',
                        '.jpg': 'image/jpeg',
                        '.gif': 'image/gif',
                        '.svg': 'image/svg+xml',
                        '.ico': 'image/x-icon'
                    };
                    const contentType = mimeTypes[ext] || 'application/octet-stream';

                    res.writeHead(200, {
                        'Content-Type': contentType,
                        'Content-Length': stats.size
                    });

                    // Garantizar la espera del streaming del archivo antes de finalizar el handler
                    await new Promise((resolve, reject) => {
                        const stream = fs.createReadStream(filePath);
                        stream.pipe(res);
                        stream.on('end', resolve);
                        stream.on('error', reject);
                    });
                } catch (err) {
                    res.writeHead(404);
                    res.end("Not Found");
                }
            },
            summary: `Servir archivos estáticos desde ${prefix}`,
            description: `Sirve el contenido físico de la carpeta ${directoryPath}`,
            isStatic: true,
            tags: ["Estáticos"]
        });
    }

    // Parseador asíncrono del cuerpo JSON
    _parseJsonBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
                if (!body) return resolve({});
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(new Error("Formato JSON inválido"));
                }
            });
            req.on('error', err => reject(err));
        });
    }

    // Motor de validación y coerción de esquemas
    _validate(data, schema) {
        const errors = [];
        const validated = {};

        for (const [key, rules] of Object.entries(schema)) {
            let value = data[key];

            if (value === undefined || value === null) {
                if (rules.required) {
                    errors.push(`El campo '${key}' es obligatorio.`);
                    continue;
                }
                validated[key] = rules.default !== undefined ? rules.default : null;
                continue;
            }

            if (rules.type === 'number') {
                const num = Number(value);
                if (isNaN(num)) {
                    errors.push(`El campo '${key}' debe ser un número válido.`);
                } else {
                    validated[key] = num;
                }
            } else if (rules.type === 'boolean') {
                if (value === 'true' || value === true || value === 1 || value === '1') {
                    validated[key] = true;
                } else if (value === 'false' || value === false || value === 0 || value === '0') {
                    validated[key] = false;
                } else {
                    errors.push(`El campo '${key}' debe ser un booleano.`);
                }
            } else if (rules.type === 'string') {
                validated[key] = String(value);
            } else {
                validated[key] = value;
            }
        }

        return { errors, validated };
    }

    // Generador automático de OpenAPI 3.0.0
    async _getOpenAPISchema() {
        const paths = {};
        
        // 1. Fetch all CPT schemas from database (with preloading)
        let schemas = [];
        try {
            if (globalThis.db) {
                if (globalThis.db._adapter && typeof globalThis.db._adapter.preloadAll === 'function') {
                    for (const col of globalThis.db._collections.values()) {
                        col._loaded = false;
                    }
                    await globalThis.db._adapter.preloadAll();
                }
                const schemaCol = globalThis.db.collection('_cpt_schemas');
                if (schemaCol) {
                    schemas = schemaCol.find({}).toArray();
                }
            }
        } catch (e) {
            // Silently skip if DB not loaded
        }

        // Helper to map schema to OpenAPI properties
        const mapColumnsToProperties = (columns) => {
            const properties = {};
            const required = [];
            if (Array.isArray(columns)) {
                columns.forEach(col => {
                    let type = 'string';
                    let format = undefined;
                    if (col.type === 'number') {
                        type = 'number';
                    } else if (col.type === 'checkbox') {
                        type = 'boolean';
                    } else if (col.type === 'date') {
                        type = 'string';
                        format = 'date';
                    } else if (col.type === 'datetime') {
                        type = 'string';
                        format = 'date-time';
                    }
                    properties[col.name] = { type };
                    if (format) properties[col.name].format = format;
                    if (col.required) required.push(col.name);
                });
            }
            return { properties, required };
        };

        for (const route of this.routes) {
            if (route.isStatic) continue;

            // Check if it is a dynamic CPT route
            if (route.path.includes('/:collection')) {
                // Generate specific paths for each registered CPT schema
                for (const schema of schemas) {
                    if (schema.name === 'users') continue; // Handled below under /users

                    const cptPath = route.path.replace('/:collection', `/${schema.name}`);
                    const openApiPath = cptPath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
                    if (!paths[openApiPath]) paths[openApiPath] = {};

                    const parameters = [];
                    for (const key of route.keys) {
                        if (key !== 'collection') {
                            parameters.push({
                                name: key,
                                in: 'path',
                                required: true,
                                schema: { type: 'string' }
                            });
                        }
                    }

                    const cptTag = schema.name.charAt(0).toUpperCase() + schema.name.slice(1);
                    const operation = {
                        summary: route.summary.replace('/:collection', `/${schema.name}`).replace(':collection', schema.name),
                        description: route.description || `Operaciones CRUD para la colección ${schema.name}`,
                        tags: [cptTag],
                        parameters
                    };

                    // For POST / PUT, generate exact body schema based on CPT columns
                    if (['POST', 'PUT'].includes(route.method)) {
                        const { properties, required } = mapColumnsToProperties(schema.columns);
                        operation.requestBody = {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties,
                                        ...(required.length > 0 ? { required } : {})
                                    }
                                }
                            }
                        };
                    }

                    operation.responses = {
                        '200': {
                            description: 'Operación Exitosa',
                            content: { 'application/json': { schema: { type: 'object' } } }
                        },
                        '400': {
                            description: 'Error de Validación',
                            content: { 'application/json': { schema: { type: 'object' } } }
                        }
                    };

                    paths[openApiPath][route.method.toLowerCase()] = operation;
                }
            } else {
                // Standard route (non-dynamic CPT)
                const openApiPath = route.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
                if (!paths[openApiPath]) paths[openApiPath] = {};

                const parameters = [];
                for (const key of route.keys) {
                    parameters.push({
                        name: key,
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    });
                }

                if (route.querySchema) {
                    for (const [key, rules] of Object.entries(route.querySchema)) {
                        parameters.push({
                            name: key,
                            in: 'query',
                            required: rules.required || false,
                            schema: {
                                type: rules.type,
                                default: rules.default
                            }
                        });
                    }
                }

                const operation = {
                    summary: route.summary,
                    description: route.description,
                    tags: route.tags || [],
                    parameters
                };

                // Special handling for /users endpoints (injecting dynamic user schema fields!)
                if (route.path.startsWith('/users') && ['POST', 'PUT'].includes(route.method)) {
                    const userSchema = schemas.find(s => s.name === 'users');
                    const customCols = userSchema ? userSchema.columns : [];
                    
                    const properties = {
                        email: { type: 'string' },
                        name: { type: 'string' },
                        password: { type: 'string' },
                        roles: { type: 'array', items: { type: 'string' } },
                        active: { type: 'boolean' }
                    };
                    const required = [];
                    if (route.method === 'POST') {
                        required.push('email', 'password');
                    }

                    // Append custom fields
                    const { properties: customProps } = mapColumnsToProperties(customCols);
                    Object.assign(properties, customProps);

                    operation.requestBody = {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties,
                                    ...(required.length > 0 ? { required } : {})
                                }
                            }
                        }
                    };
                } else if (route.bodySchema) {
                    const properties = {};
                    const required = [];
                    for (const [key, rules] of Object.entries(route.bodySchema)) {
                        properties[key] = { type: rules.type };
                        if (rules.required) required.push(key);
                    }
                    operation.requestBody = {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties,
                                    ...(required.length > 0 ? { required } : {})
                                }
                            }
                        }
                    };
                }

                operation.responses = {
                    '200': {
                        description: 'Operación Exitosa',
                        content: { 'application/json': { schema: { type: 'object' } } }
                    },
                    '400': {
                        description: 'Error de Validación',
                        content: { 'application/json': { schema: { type: 'object' } } }
                    }
                };

                paths[openApiPath][route.method.toLowerCase()] = operation;
            }
        }

        return {
            openapi: '3.0.0',
            info: {
                title: this.title,
                version: this.version,
                description: this.description
            },
            paths
        };
    }

    _getSwaggerHtml() {
        return `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>${this.title} - Swagger UI</title>
            <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
            <style>
                html { box-sizing: border-box; }
                body { margin: 0; background: #fafafa; }
            </style>
        </head>
        <body>
            <div id="swagger-ui"></div>
            <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
            <script>
                window.onload = () => {
                    window.ui = SwaggerUIBundle({
                        url: '/openapi.json',
                        dom_id: '#swagger-ui',
                        deepLinking: true,
                        presets: [
                            SwaggerUIBundle.presets.apis
                        ]
                    });
                };
            </script>
        </body>
        </html>
        `;
    }

    // Inicia el servidor nativo y maneja el pipeline de middlewares y rutas
    listen(port, callback) {
        this.server = http.createServer(async (req, res) => {
            // Helpers de respuesta incorporados
            res.json = (data, status = 200) => {
                if (res.writableEnded || res.headersSent) return;
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));
            };
            res.html = (html, status = 200) => {
                if (res.writableEnded || res.headersSent) return;
                res.writeHead(status, { 'Content-Type': 'text/html' });
                res.end(html);
            };

            // Inyección CORS
            if (this.cors) {
                res.setHeader('Access-Control-Allow-Origin', this.cors.allowOrigins ? this.cors.allowOrigins.join(', ') : '*');
                res.setHeader('Access-Control-Allow-Methods', this.cors.allowMethods ? this.cors.allowMethods.join(', ') : '*');
                res.setHeader('Access-Control-Allow-Headers', this.cors.allowHeaders ? this.cors.allowHeaders.join(', ') : '*');
                
                if (req.method === 'OPTIONS') {
                    res.writeHead(204);
                    return res.end();
                }
            }

            const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const pathname = parsedUrl.pathname;
            const query = Object.fromEntries(parsedUrl.searchParams.entries());

            // Lógica Centralizada de Ejecución (Pipeline de Middlewares + Enrutado)
            const pipeline = async () => {
                // 1. Validar Rutas Internas de Swagger
                if (pathname === '/openapi.json' && req.method === 'GET') {
                    return res.json(await this._getOpenAPISchema());
                }
                if (pathname === '/docs' && req.method === 'GET') {
                    return res.html(this._getSwaggerHtml());
                }

                // 2. Emparejar Ruta
                let matchedRoute = null;
                let pathParams = {};

                for (const route of this.routes) {
                    if (route.method !== req.method) continue;

                    const match = route.regex.exec(pathname);
                    if (match) {
                        matchedRoute = route;
                        route.keys.forEach((key, index) => {
                            // En caso de archivos estáticos (*), guardamos el filepath completo
                            if (route.isStatic && key === 'filepath') {
                                pathParams[key] = match[index + 1];
                            } else {
                                pathParams[key] = match[index + 1];
                            }
                        });
                        break;
                    }
                }

                if (!matchedRoute) {
                    return res.json({ detail: "Not Found" }, 404);
                }

                // 3. Parsear Cuerpo
                let rawBody = {};
                if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
                    rawBody = await this._parseJsonBody(req);
                }

                // 4. Validar Parámetros Query
                let validatedQuery = {};
                if (matchedRoute.querySchema) {
                    const { errors, validated } = this._validate(query, matchedRoute.querySchema);
                    if (errors.length > 0) {
                        return res.json({ detail: "Error de validación en parámetros query", errors }, 400);
                    }
                    validatedQuery = validated;
                } else {
                    validatedQuery = query;
                }

                // 5. Validar Cuerpo
                let validatedBody = {};
                if (matchedRoute.bodySchema) {
                    const { errors, validated } = this._validate(rawBody, matchedRoute.bodySchema);
                    if (errors.length > 0) {
                        return res.json({ detail: "Error de validación en cuerpo (body)", errors }, 400);
                    }
                    validatedBody = validated;
                } else {
                    validatedBody = rawBody;
                }

                req.params = pathParams;
                req.query = validatedQuery;
                req.body = validatedBody;
                req.bodyJson = validatedBody; // Soporte dual coherente con el Edge

                // 6. Inyección de Dependencias
                const resolvedDeps = {};
                if (matchedRoute.dependencies) {
                    for (const [depName, depFunc] of Object.entries(matchedRoute.dependencies)) {
                        resolvedDeps[depName] = await depFunc(req, res);
                    }
                }

                // 7. Ejecutar Controlador Principal
                const result = await matchedRoute.handler(req, res, resolvedDeps);
                if (!res.writableEnded && !res.headersSent) {
                    res.json(result);
                }
            };

            // Ejecución del Pipeline Asíncrono de Middlewares
            try {
                let index = 0;
                const next = async () => {
                    if (index < this.middlewares.length) {
                        const middleware = this.middlewares[index++];
                        await middleware(req, res, next);
                    } else {
                        await pipeline();
                    }
                };
                await next();
            } catch (err) {
                // Gestor de Excepciones
                let handler = null;
                for (const [type, h] of this.exceptionHandlers.entries()) {
                    if (err.constructor === type || err.name === type || err instanceof type) {
                        handler = h;
                        break;
                    }
                }
                if (!handler) {
                    handler = this.defaultExceptionHandler;
                }
                
                try {
                    handler(req, res, err);
                } catch (handlerErr) {
                    console.error("Error crítico en Exception Handler:", handlerErr);
                    if (!res.writableEnded) {
                        res.json({ detail: "Error interno del servidor" }, 500);
                    }
                }
            }
        });

        // Configuración de optimización de sockets nativos para alta concurrencia
        this.server.keepAliveTimeout = 60000;
        this.server.headersTimeout = 65000;

        this.server.listen(port, callback);
        return this.server;
    }
}

module.exports = {
    FastAPI,
    APIRouter
};
