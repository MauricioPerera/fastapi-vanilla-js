const { APIRouter } = require('../lib/fastapi');
const { getCurrentUser } = require('../dependencies/auth');

const chatRouter = new APIRouter({
    prefix: '/chat',
    tags: ['IA Chat'],
    dependencies: { user: getCurrentUser }
});

chatRouter.post('/copilot', async (req, res, deps) => {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
        return res.json({ detail: "Campo 'messages' es obligatorio y debe ser un array" }, 400);
    }
    
    const lastMsg = messages[messages.length - 1]?.content || "";
    return {
        mensaje: "Generación de texto completada usando IBM Granite 4.0 Micro (Simulación Local)",
        resultado: {
            response: `[Simulación Local de Granite-4.0] He recibido tu mensaje: "${lastMsg}". Para usar el modelo real en el Edge, despliega en Cloudflare Pages.`
        }
    };
}, {
    summary: "Simular Chat Copilot con IBM Granite 4.0"
});

module.exports = chatRouter;
