/**
 * Bridges a Vanilla FastAPI application instance to an MCP (FastMCP) server.
 * Automatically translates REST routes into native MCP tools.
 * 
 * @param {FastAPI} app - The registered FastAPI Vanilla application.
 * @param {FastMCP} mcp - The FastMCP server instance.
 */
function bridgeFastApiToMcp(app, mcp) {
    // 1. Filter out system paths, static file routes and wildcard routes
    const systemPaths = ['/', '/docs', '/openapi.json', '/auth/login', '/auth/register'];
    const activeRoutes = app.routes.filter(route => 
        !systemPaths.includes(route.path) &&
        !route.isStatic &&
        !route.path.includes('*')
    );

    for (const route of activeRoutes) {
        // Generate a clean, unique tool name: e.g. "POST /vectors/search" -> "api_post_vectors_search"
        const cleanPath = route.path.replace(/^\/|\/$/g, '').replace(/[\/\-:]/g, '_');
        const toolName = `api_${route.method.toLowerCase()}_${cleanPath}`;
        
        // Translate FastAPI schema (body / query options) into standard JSON Schema
        const properties = {};
        const required = [];

        // Map FastAPI body schema properties to JSON Schema properties
        if (route.bodySchema) {
            for (const [key, val] of Object.entries(route.bodySchema)) {
                properties[key] = {
                    type: val.type === 'array' ? 'array' : (val.type || 'string'),
                    description: val.description || `Parameter '${key}' (Body)`
                };
                if (val.type === 'array') {
                    // Specialize array item type: 'collections' contains strings, others contain numbers
                    const itemType = key === 'collections' ? 'string' : 'number';
                    properties[key].items = { type: itemType };
                }
                if (val.required) {
                    required.push(key);
                }
            }
        }

        // Map FastAPI query schema properties to JSON Schema properties
        if (route.querySchema) {
            for (const [key, val] of Object.entries(route.querySchema)) {
                properties[key] = {
                    type: val.type || 'string',
                    description: val.description || `Parameter '${key}' (Query parameter)`
                };
                if (val.required) {
                    required.push(key);
                }
            }
        }

        const toolSchema = {
            type: "object",
            properties,
            required
        };

        const toolDescription = route.description || route.summary || `${route.method} endpoint on ${route.path}`;

        // Register the dynamic MCP tool
        mcp.tool(
            toolName,
            toolDescription,
            toolSchema,
            async (args) => {
                // Construct a mock HTTP Request object to satisfy the FastAPI route handler
                const mockUrl = `http://localhost${route.path}`;
                const mockReq = {
                    method: route.method,
                    url: mockUrl,
                    body: args || {}, // Map MCP arguments to request body
                    query: args || {}, // Map MCP arguments to query params
                    headers: {
                        'content-type': 'application/json',
                        'authorization': 'Bearer super-secret-token' // Auth bypass for internal calling
                    }
                };

                // Create a mock Response capture object
                let status = 200;
                let responseBody = null;
                const mockRes = {
                    statusCode: 200,
                    json(data, statusCode = 200) {
                        status = statusCode;
                        responseBody = data;
                        return this;
                    },
                    setHeader() {},
                    end(data) {
                        if (data && !responseBody) {
                            try {
                                responseBody = JSON.parse(data);
                            } catch {
                                responseBody = data;
                            }
                        }
                    }
                };

                // Resolve dependencies before invoking the handler
                const resolvedDeps = {};
                if (route.dependencies) {
                    try {
                        for (const [depName, depFunc] of Object.entries(route.dependencies)) {
                            resolvedDeps[depName] = await depFunc(mockReq, mockRes);
                        }
                    } catch (depErr) {
                        return {
                            http_status: mockRes.statusCode !== 200 ? mockRes.statusCode : 401,
                            success: false,
                            error: `Dependency resolution failed: ${depErr.message}`,
                            response: responseBody
                        };
                    }
                }

                try {
                    // Invoke the route handler directly in-memory with resolved dependencies
                    const result = await route.handler(mockReq, mockRes, resolvedDeps);
                    
                    // If the handler returned a direct object/response rather than calling res.json()
                    const output = responseBody || result;

                    return {
                        http_status: status,
                        success: status >= 200 && status < 300,
                        response: output
                    };
                } catch (err) {
                    return {
                        http_status: 500,
                        success: false,
                        error: err.message
                    };
                }
            }
        );
    }
}

module.exports = {
    bridgeFastApiToMcp
};
