import { validate, serialize, coerce } from './validation.js';

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
            model: options.model || null,
            responseModel: options.responseModel || null,
            coerce: options.coerce || false,
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
            model: options.model || null,
            responseModel: options.responseModel || null,
            coerce: options.coerce || false,
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

    async _getOpenAPISchema() {
        const paths = {};
        const schemas = await _loadCptSchemas();

        for (const route of this.routes) {
            if (route.path.includes('/:collection')) {
                _buildCptPaths(route, schemas, paths);
            } else {
                _buildStandardPath(route, schemas, paths);
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

    // Método centralizado para manejar llamadas HTTP en el Edge (Cloudflare fetch handler)
    async handle(request, env, ctx) {
        const corsHeaders = this._corsHeaders();
        if (this.cors && request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        try {
            let index = 0;
            const next = async () => {
                if (index < this.middlewares.length) {
                    return await this.middlewares[index++](request, env, ctx, next);
                }
                return await this._executePipeline(request, env, ctx, corsHeaders);
            };
            return await next();
        } catch (err) {
            return this._handleEdgeException(request, err, env, ctx);
        }
    }

    _corsHeaders() {
        const h = {};
        if (this.cors) {
            h['Access-Control-Allow-Origin'] = this.cors.allowOrigins ? this.cors.allowOrigins.join(', ') : '*';
            h['Access-Control-Allow-Methods'] = this.cors.allowMethods ? this.cors.allowMethods.join(', ') : '*';
            h['Access-Control-Allow-Headers'] = this.cors.allowHeaders ? this.cors.allowHeaders.join(', ') : '*';
        }
        return h;
    }

    _buildResponse(data, status = 200, contentType = 'application/json', corsHeaders = {}) {
        const body = contentType === 'application/json' ? JSON.stringify(data) : data;
        return new Response(body, {
            status,
            headers: { 'Content-Type': contentType, ...corsHeaders }
        });
    }

    async _executePipeline(request, env, ctx, corsHeaders) {
        const urlObj = new URL(request.url);
        const pathname = urlObj.pathname;

        const builtin = await this._edgeBuiltinRoutes(request, pathname, corsHeaders);
        if (builtin) return builtin;

        const matched = this._matchRoute(pathname, request.method);
        if (!matched) return this._buildResponse({ detail: "Not Found" }, 404, 'application/json', corsHeaders);
        const { route, pathParams } = matched;

        let rawBody = {};
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
            try { rawBody = await request.json(); } catch (e) { rawBody = {}; }
        }

        const queryData = Object.fromEntries(urlObj.searchParams.entries());
        const v = this._validateRequest(route, queryData, rawBody);
        if (!v.ok) return this._buildResponse(v.error, v.status, 'application/json', corsHeaders);

        request.params = pathParams;
        request.query = v.validatedQuery;
        request.bodyJson = v.validatedBody;
        this._injectBody(request, v.validatedBody);

        const resolvedDeps = await this._resolveDeps(route, request, env, ctx);

        const result = await route.handler(request, env, ctx, resolvedDeps);
        if (result instanceof Response) return result;

        // response_model: proyecta la respuesta a los campos declarados.
        const out = route.responseModel ? serialize(result, route.responseModel) : result;
        return this._buildResponse(out, 200, 'application/json', corsHeaders);
    }

    async _edgeBuiltinRoutes(request, pathname, corsHeaders) {
        if (pathname === '/openapi.json' && request.method === 'GET') {
            return this._buildResponse(await this._getOpenAPISchema(), 200, 'application/json', corsHeaders);
        }
        if (pathname === '/docs' && request.method === 'GET') {
            return this._buildResponse(this._getSwaggerHtml(), 200, 'text/html', corsHeaders);
        }
        return null;
    }

    _matchRoute(pathname, method) {
        for (const route of this.routes) {
            if (route.method !== method) continue;
            const match = route.regex.exec(pathname);
            if (match) {
                const pathParams = {};
                route.keys.forEach((key, index) => { pathParams[key] = match[index + 1]; });
                return { route, pathParams };
            }
        }
        return null;
    }

    // Valida query, body y modelo tipado. En error devuelve { ok:false, status, error }.
    _validateRequest(route, queryData, rawBody) {
        let validatedQuery = queryData;
        if (route.querySchema) {
            const { errors, validated } = this._validate(queryData, route.querySchema);
            if (errors.length > 0) {
                return { ok: false, status: 400, error: { detail: "Error de validación en parámetros query", errors } };
            }
            validatedQuery = validated;
        }

        let validatedBody = rawBody;
        if (route.bodySchema) {
            const { errors, validated } = this._validate(rawBody, route.bodySchema);
            if (errors.length > 0) {
                return { ok: false, status: 400, error: { detail: "Error de validación en cuerpo (body)", errors } };
            }
            validatedBody = validated;
        }

        if (route.model) {
            const data = route.coerce ? coerce(validatedBody, route.model) : validatedBody;
            const { valid, errors } = validate(data, route.model);
            if (!valid) {
                return { ok: false, status: 422, error: { detail: "Error de validación", errors } };
            }
            if (route.coerce) validatedBody = data;
        }

        return { ok: true, validatedQuery, validatedBody };
    }

    // Soporte dual coherente con Node.js (bypasseando la propiedad de solo lectura de Request nativo).
    _injectBody(request, validatedBody) {
        try {
            Object.defineProperty(request, 'body', {
                value: validatedBody,
                writable: true,
                configurable: true,
                enumerable: true
            });
        } catch (e) {
            request.body = validatedBody;
        }
    }

    async _resolveDeps(route, request, env, ctx) {
        const resolvedDeps = {};
        if (route.dependencies) {
            for (const [depName, depFunc] of Object.entries(route.dependencies)) {
                resolvedDeps[depName] = await depFunc(request, env, ctx);
            }
        }
        return resolvedDeps;
    }

    async _handleEdgeException(request, err, env, ctx) {
        let handler = null;
        for (const [type, h] of this.exceptionHandlers.entries()) {
            if (err.constructor === type || err.name === type || (typeof type === 'function' && err instanceof type)) {
                handler = h;
                break;
            }
        }
        if (!handler) handler = this.defaultExceptionHandler;

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

// ============================================================================
// Helpers de generación OpenAPI (puros, a nivel de módulo)
// ============================================================================

// Mapeo de tipo de columna CPT → tipo/format OpenAPI (reemplaza la cadena if/else anidada).
const _COL_TYPE_MAP = {
    number:   { type: 'number' },
    checkbox: { type: 'boolean' },
    date:     { type: 'string', format: 'date' },
    datetime: { type: 'string', format: 'date-time' },
};

const _openApiResponses = () => ({
    '200': { description: 'Operación Exitosa', content: { 'application/json': { schema: { type: 'object' } } } },
    '400': { description: 'Error de Validación', content: { 'application/json': { schema: { type: 'object' } } } }
});

function _jsonRequestBody(properties, required) {
    return {
        required: true,
        content: { 'application/json': { schema: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) } } }
    };
}

function _pathParams(keys, skip) {
    const parameters = [];
    for (const key of keys) {
        if (skip && key === skip) continue;
        parameters.push({ name: key, in: 'path', required: true, schema: { type: 'string' } });
    }
    return parameters;
}

function _mapColumnsToProperties(columns) {
    const properties = {};
    const required = [];
    if (!Array.isArray(columns)) return { properties, required };
    for (const col of columns) {
        const mapped = _COL_TYPE_MAP[col.type] || { type: 'string' };
        properties[col.name] = { type: mapped.type };
        if (mapped.format) properties[col.name].format = mapped.format;
        if (col.required) required.push(col.name);
    }
    return { properties, required };
}

async function _loadCptSchemas() {
    try {
        if (globalThis.db) {
            if (!globalThis.cptsPreloaded && globalThis.db._adapter && typeof globalThis.db._adapter.preloadAll === 'function') {
                await globalThis.db._adapter.preloadAll();
                globalThis.cptsPreloaded = true;
            }
            const schemaCol = globalThis.db.collection('_cpt_schemas');
            if (schemaCol) return schemaCol.find({}).toArray();
        }
    } catch (e) {
        // Silently skip if DB not loaded
    }
    return [];
}

function _buildCptPaths(route, schemas, paths) {
    for (const schema of schemas) {
        if (schema.name === 'users') continue; // Handled under /users
        const cptPath = route.path.replace('/:collection', `/${schema.name}`);
        const openApiPath = cptPath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
        if (!paths[openApiPath]) paths[openApiPath] = {};

        const cptTag = schema.name.charAt(0).toUpperCase() + schema.name.slice(1);
        const operation = {
            summary: route.summary.replace('/:collection', `/${schema.name}`).replace(':collection', schema.name),
            description: route.description || `Operaciones CRUD para la colección ${schema.name}`,
            tags: [cptTag],
            parameters: _pathParams(route.keys, 'collection')
        };
        if (['POST', 'PUT'].includes(route.method)) {
            const { properties, required } = _mapColumnsToProperties(schema.columns);
            operation.requestBody = _jsonRequestBody(properties, required);
        }
        operation.responses = _openApiResponses();
        paths[openApiPath][route.method.toLowerCase()] = operation;
    }
}

function _usersRequestBody(route, schemas) {
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
    if (route.method === 'POST') required.push('email', 'password');
    const { properties: customProps } = _mapColumnsToProperties(customCols);
    Object.assign(properties, customProps);
    return _jsonRequestBody(properties, required);
}

function _bodySchemaRequestBody(bodySchema) {
    const properties = {};
    const required = [];
    for (const [key, rules] of Object.entries(bodySchema)) {
        properties[key] = { type: rules.type };
        if (rules.required) required.push(key);
    }
    return _jsonRequestBody(properties, required);
}

function _buildStandardPath(route, schemas, paths) {
    const openApiPath = route.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
    if (!paths[openApiPath]) paths[openApiPath] = {};

    const parameters = _pathParams(route.keys);
    if (route.querySchema) {
        for (const [key, rules] of Object.entries(route.querySchema)) {
            parameters.push({ name: key, in: 'query', required: rules.required || false, schema: { type: rules.type, default: rules.default } });
        }
    }

    const operation = { summary: route.summary, description: route.description, tags: route.tags || [], parameters };
    if (route.path.startsWith('/users') && ['POST', 'PUT'].includes(route.method)) {
        operation.requestBody = _usersRequestBody(route, schemas);
    } else if (route.bodySchema) {
        operation.requestBody = _bodySchemaRequestBody(route.bodySchema);
    }
    operation.responses = _openApiResponses();
    paths[openApiPath][route.method.toLowerCase()] = operation;
}
