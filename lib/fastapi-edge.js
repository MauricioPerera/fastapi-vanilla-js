// ============================================================================
// 1. CLASE APIRouter (Modularización en el Edge)
// ============================================================================
export class APIRouter {
    constructor(options = {}) {
        this.prefix = options.prefix || "";
        this.tags = options.tags || [];
        this.dependencies = options.dependencies || null;
        this.routes = [];
    }

    _pathToRegex(pathStr) {
        let fullPath = (this.prefix + pathStr).replace(/\/+/g, '/');
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
// 2. CLASE FastAPI (Core Edge Engine)
// ============================================================================
export class FastAPI {
    constructor(config = {}) {
        this.title = config.title || "FastAPI Edge";
        this.version = config.version || "1.0.0";
        this.description = config.description || "Clean room Edge reinterpretation of FastAPI";
        this.routes = [];
        this.middlewares = [];
        this.exceptionHandlers = new Map();
        this.cors = config.cors || null;

        // Manejador de excepciones por defecto para el Edge
        this.defaultExceptionHandler = (request, err) => {
            return new Response(JSON.stringify({
                detail: "Internal Server Error",
                error: err.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        };
    }

    addMiddleware(middlewareFunc) {
        this.middlewares.push(middlewareFunc);
    }

    addExceptionHandler(errorType, handler) {
        this.exceptionHandlers.set(errorType, handler);
    }

    includeRouter(router) {
        this.routes.push(...router.routes);
    }

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

    _getOpenAPISchema() {
        const paths = {};
        for (const route of this.routes) {
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

            if (route.bodySchema) {
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

    // Método centralizado para manejar llamadas HTTP en el Edge (Cloudflare fetch handler)
    async handle(request, env, ctx) {
        const urlObj = new URL(request.url);
        const pathname = urlObj.pathname;

        // Inyector CORS
        const corsHeaders = {};
        if (this.cors) {
            corsHeaders['Access-Control-Allow-Origin'] = this.cors.allowOrigins ? this.cors.allowOrigins.join(', ') : '*';
            corsHeaders['Access-Control-Allow-Methods'] = this.cors.allowMethods ? this.cors.allowMethods.join(', ') : '*';
            corsHeaders['Access-Control-Allow-Headers'] = this.cors.allowHeaders ? this.cors.allowHeaders.join(', ') : '*';
            
            if (request.method === 'OPTIONS') {
                return new Response(null, { status: 204, headers: corsHeaders });
            }
        }

        const buildResponse = (data, status = 200, contentType = 'application/json') => {
            const body = contentType === 'application/json' ? JSON.stringify(data) : data;
            return new Response(body, {
                status,
                headers: {
                    'Content-Type': contentType,
                    ...corsHeaders
                }
            });
        };

        const executePipeline = async () => {
            // 1. Validar Rutas Internas de Swagger
            if (pathname === '/openapi.json' && request.method === 'GET') {
                return buildResponse(this._getOpenAPISchema());
            }
            if (pathname === '/docs' && request.method === 'GET') {
                return buildResponse(this._getSwaggerHtml(), 200, 'text/html');
            }

            // 2. Emparejar Ruta
            let matchedRoute = null;
            let pathParams = {};

            for (const route of this.routes) {
                if (route.method !== request.method) continue;

                const match = route.regex.exec(pathname);
                if (match) {
                    matchedRoute = route;
                    route.keys.forEach((key, index) => {
                        pathParams[key] = match[index + 1];
                    });
                    break;
                }
            }

            if (!matchedRoute) {
                return buildResponse({ detail: "Not Found" }, 404);
            }

            // 3. Parsear Cuerpo (Body)
            let rawBody = {};
            if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
                try {
                    rawBody = await request.json();
                } catch (e) {
                    rawBody = {};
                }
            }

            // 4. Validar Parámetros Query
            let validatedQuery = {};
            const queryData = Object.fromEntries(urlObj.searchParams.entries());
            if (matchedRoute.querySchema) {
                const { errors, validated } = this._validate(queryData, matchedRoute.querySchema);
                if (errors.length > 0) {
                    return buildResponse({ detail: "Error de validación en parámetros query", errors }, 400);
                }
                validatedQuery = validated;
            } else {
                validatedQuery = queryData;
            }

            // 5. Validar Cuerpo
            let validatedBody = {};
            if (matchedRoute.bodySchema) {
                const { errors, validated } = this._validate(rawBody, matchedRoute.bodySchema);
                if (errors.length > 0) {
                    return buildResponse({ detail: "Error de validación en cuerpo (body)", errors }, 400);
                }
                validatedBody = validated;
            } else {
                validatedBody = rawBody;
            }

            // Mutar el objeto request inyectando datos parsed/validados
            request.params = pathParams;
            request.query = validatedQuery;
            request.bodyJson = validatedBody;

            // 6. Inyección de Dependencias
            const resolvedDeps = {};
            if (matchedRoute.dependencies) {
                for (const [depName, depFunc] of Object.entries(matchedRoute.dependencies)) {
                    resolvedDeps[depName] = await depFunc(request, env, ctx);
                }
            }

            // 7. Ejecutar Controlador Principal
            const result = await matchedRoute.handler(request, env, ctx, resolvedDeps);
            
            // Si el controlador retorna una respuesta Response nativa, la entregamos directamente
            if (result instanceof Response) {
                return result;
            }
            
            return buildResponse(result);
        };

        // Ejecutar pipeline de middlewares asíncronos en el Edge
        try {
            let index = 0;
            const next = async () => {
                if (index < this.middlewares.length) {
                    const middleware = this.middlewares[index++];
                    return await middleware(request, env, ctx, next);
                } else {
                    return await executePipeline();
                }
            };
            return await next();
        } catch (err) {
            // Gestor de Excepciones del Edge
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
                return await handler(request, err, env, ctx);
            } catch (handlerErr) {
                return new Response(JSON.stringify({ detail: "Error interno del servidor en Edge Exception Handler" }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }
    }
}
