// routers/postal.js
// Capa POSTAL — MEMORIA DE PROYECTO / INTERACCION ENTRE AGENTES.
// Endpoints REST sobre lib/postal.js (event log append-only firmado encadenado + projector).
//   POST /repos/:name/identities — generar y registrar identidad de agente (P-256 ECDSA).
//   GET  /repos/:name/identities  — listar identidades registradas (claves publicas).
//   POST /repos/:name/events      — un agente posta un evento (mensaje/interaccion).
//   GET  /repos/:name/timeline    — historial legible del recorrido.
//   GET  /repos/:name/state        — estado proyectado reconstruido desde el log.
//   POST /repos/:name/identities/:agentId/rotate — rotar la clave de una identidad.
//   POST /repos/:name/identities/:agentId/revoke — revocar la clave vigente de una identidad.
//   GET  /repos/:name/identities/:agentId/keys   — estado/historial de claves de una identidad.
//
// PROVENANCE: la clave PRIVADA no se persiste server-side; POST /identities la devuelve
// una sola vez al llamante, que debe reenviarla como body.identity.signPrivateJwk al
// postear eventos. Solo la PUBLICA se guarda en .data/identities/<repo>.json (append-only).

const { APIRouter } = require('../lib/fastapi');
const path = require('path');
const {
    appendEvent,
    listEvents,
    replayEvents,
    registerIdentity,
    listIdentities,
    generateIdentity,
    getKeyHistory,
    PostalError
} = require('../lib/postal');
const { RepoError } = require('../lib/gitRepos');
const { getCurrentUser } = require('../dependencies/auth');

const EVENTS_DIR = path.join(__dirname, '..', '.data', 'events');
const IDENTITIES_DIR = path.join(__dirname, '..', '.data', 'identities');

// HARDENING: todo endpoint (GET + escritura) exige token Bearer via getCurrentUser.
// Reusa dependencies/auth.js (mismo patron que routers/items.js). Sin token -> 401.
const postalRouter = new APIRouter({
    prefix: '/repos',
    tags: ['Postal'],
    dependencies: { user: getCurrentUser }
});

// Helper: mapea PostalError/RepoError a respuesta REST con el status adecuado.
function postalErrorResponse(res, err) {
    if (err instanceof PostalError) {
        const status = err.code === 'invalid_input' ? 400 : 500;
        return res.json({ detail: 'PostalError', code: err.code, mensaje: err.message }, status);
    }
    if (err instanceof RepoError) {
        const status = err.code === 'invalid_name' ? 400 : 500;
        return res.json({ detail: 'RepoError', code: err.code, mensaje: err.message }, status);
    }
    return res.json({ detail: 'Error interno', mensaje: err.message }, 500);
}

// Generar y registrar una identidad de agente (keypair ECDSA P-256). Devuelve agentId
// (fingerprint), la clave PUBLICA (registrada) y la PRIVADA (NO persistida; una sola vez).
postalRouter.post('/:name/identities', async (req, res) => {
    try {
        const kp = await generateIdentity();
        const reg = await registerIdentity(req.params.name, IDENTITIES_DIR, kp.publicKeyJwk);
        return {
            mensaje: reg.existed ? 'Identidad ya registrada (idempotente)' : 'Identidad registrada',
            agentId: reg.agentId,
            publicKeyJwk: reg.publicKeyJwk,
            privateKeyJwk: kp.privateKeyJwk,
            existed: reg.existed,
            advertencia: 'La privateKeyJwk NO se persiste. Guardala; reenviala como body.identity.signPrivateJwk al postear eventos.'
        };
    } catch (err) {
        return postalErrorResponse(res, err);
    }
}, {
    summary: 'Generar y registrar identidad de agente (P-256)',
    description: 'Crea un keypair ECDSA P-256, deriva agentId = base64url(SHA-256(SPKI)), registra la PUBLICA (append-only) y devuelve la PRIVADA una sola vez (no persistida).'
});

// Listar las identidades registradas del repo (solo claves publicas).
postalRouter.get('/:name/identities', async (req, res) => {
    try {
        const identities = await listIdentities(req.params.name, IDENTITIES_DIR);
        return { mensaje: 'Identidades registradas', total: identities.length, identities };
    } catch (err) {
        return postalErrorResponse(res, err);
    }
}, {
    summary: 'Listar identidades registradas',
    description: 'Devuelve las identidades (agentId + publicKeyJwk) registradas en el repo. Solo claves publicas.'
});

// Postar un evento de agente (mensaje/interaccion dirigido al proyecto).
// Body: { kind, agentId, payload, to?, identity? }.
postalRouter.post('/:name/events', async (req, res) => {
    const body = req.body || {};
    if (typeof body.kind !== 'string' || !body.kind.trim()) {
        return res.json({ detail: 'Body inválido', mensaje: "'kind' es obligatorio" }, 400);
    }
    if (typeof body.agentId !== 'string' || !body.agentId.trim()) {
        return res.json({ detail: 'Body inválido', mensaje: "'agentId' es obligatorio" }, 400);
    }
    try {
        const ev = await appendEvent(req.params.name, EVENTS_DIR, {
            kind: body.kind,
            agentId: body.agentId,
            payload: body.payload,
            to: body.to,
            identity: body.identity
        });
        return { mensaje: 'Evento posteado', event: ev };
    } catch (err) {
        return postalErrorResponse(res, err);
    }
}, {
    summary: 'Postar un evento de agente',
    description: 'Append un evento firmado encadenado al log del repo (memoria del proyecto). Body: { kind, agentId, payload, to?, identity? }.',
    body: {
        kind: { type: 'string', required: true },
        agentId: { type: 'string', required: true },
        payload: { type: 'object' },
        to: { type: 'array' },
        identity: { type: 'object' }
    }
});

// Timeline / historial legible del recorrido del proyecto (para que un agente lea el contexto).
postalRouter.get('/:name/timeline', async (req, res) => {
    try {
        const r = await replayEvents(req.params.name, EVENTS_DIR, IDENTITIES_DIR);
        return { mensaje: 'Timeline del proyecto', total: r.total, verified: r.verified, timeline: r.timeline, failures: r.failures };
    } catch (err) {
        return postalErrorResponse(res, err);
    }
}, {
    summary: 'Timeline / historial del proyecto',
    description: 'Replega el log del repo a una timeline legible (qué pasó, en qué orden, quién y el resumen).'
});

// Estado proyectado reconstruido desde el log (issues + mensajes + counts).
postalRouter.get('/:name/state', async (req, res) => {
    try {
        const r = await replayEvents(req.params.name, EVENTS_DIR, IDENTITIES_DIR);
        return { mensaje: 'Estado proyectado', state: r.state, total: r.total, verified: r.verified, failures: r.failures };
    } catch (err) {
        return postalErrorResponse(res, err);
    }
}, {
    summary: 'Estado proyectado del proyecto',
    description: 'Estado reconstruido plegando los eventos verificados del log (issues, mensajes, counts).'
});

// Rotar la clave de una identidad: append un evento identity.rotated firmado por la clave
// actualmente vigente (body.identity.signPrivateJwk). Vincula una nueva publicKey al mismo
// agentId (supersedencia firmada). Body: { newPublicJwk, effective_at?, identity }.
postalRouter.post('/:name/identities/:agentId/rotate', async (req, res) => {
    const body = req.body || {};
    if (!body.newPublicJwk || typeof body.newPublicJwk !== 'object') {
        return res.json({ detail: 'Body inválido', mensaje: "'newPublicJwk' es obligatorio" }, 400);
    }
    if (!body.identity || !body.identity.signPrivateJwk) {
        return res.json({ detail: 'Body inválido', mensaje: "'identity.signPrivateJwk' es obligatorio (clave vigente)" }, 400);
    }
    try {
        const payload = { newPublicJwk: body.newPublicJwk };
        if (body.effective_at) payload.effective_at = body.effective_at;
        const ev = await appendEvent(req.params.name, EVENTS_DIR, {
            kind: 'identity.rotated',
            agentId: req.params.agentId,
            payload,
            identity: body.identity
        });
        return { mensaje: 'Clave rotada', event: ev };
    } catch (err) {
        return postalErrorResponse(res, err);
    }
}, {
    summary: 'Rotar la clave de una identidad',
    description: 'Append un evento identity.rotated firmado por la clave vigente: vincula una nueva publicKey al mismo agentId (cadena de supersedencia). Body: { newPublicJwk, effective_at?, identity: { signPrivateJwk } }.',
    body: {
        newPublicJwk: { type: 'object', required: true },
        effective_at: { type: 'string' },
        identity: { type: 'object', required: true }
    }
});

// Revocar una clave de una identidad: append un evento identity.revoked firmado por la
// clave que revoca (self/owner). Marca la clave targetPublicJwk revocada desde revoked_at.
// Body: { targetPublicJwk, revoked_at?, identity: { signPrivateJwk } }.
postalRouter.post('/:name/identities/:agentId/revoke', async (req, res) => {
    const body = req.body || {};
    if (!body.targetPublicJwk || typeof body.targetPublicJwk !== 'object') {
        return res.json({ detail: 'Body inválido', mensaje: "'targetPublicJwk' es obligatorio (clave a revocar)" }, 400);
    }
    if (!body.identity || !body.identity.signPrivateJwk) {
        return res.json({ detail: 'Body inválido', mensaje: "'identity.signPrivateJwk' es obligatorio (clave que revoca)" }, 400);
    }
    try {
        const payload = { targetPublicJwk: body.targetPublicJwk };
        if (body.revoked_at) payload.revoked_at = body.revoked_at;
        const ev = await appendEvent(req.params.name, EVENTS_DIR, {
            kind: 'identity.revoked',
            agentId: req.params.agentId,
            payload,
            identity: body.identity
        });
        return { mensaje: 'Clave revocada', event: ev };
    } catch (err) {
        return postalErrorResponse(res, err);
    }
}, {
    summary: 'Revocar una clave de una identidad',
    description: 'Append un evento identity.revoked firmado por la clave que revoca (self/owner). Marca targetPublicJwk como revocada desde revoked_at (default: created_at del evento). Body: { targetPublicJwk, revoked_at?, identity: { signPrivateJwk } }.',
    body: {
        targetPublicJwk: { type: 'object', required: true },
        revoked_at: { type: 'string' },
        identity: { type: 'object', required: true }
    }
});

// Historial / estado vigente de claves de una identidad (genesis + rotaciones/revocaciones).
postalRouter.get('/:name/identities/:agentId/keys', async (req, res) => {
    try {
        const state = await getKeyHistory(req.params.name, EVENTS_DIR, IDENTITIES_DIR, req.params.agentId);
        if (!state) {
            return res.json({ detail: 'Identidad no encontrada', agentId: req.params.agentId }, 404);
        }
        return { mensaje: 'Historial de claves', agentId: state.agentId, keys: state.keys };
    } catch (err) {
        return postalErrorResponse(res, err);
    }
}, {
    summary: 'Estado e historial de claves de una identidad',
    description: 'Devuelve el KeyState vigente de la identidad: claves genesis + rotadas/revocadas con status y timestamps (activated_at / superseded_at / revoked_at).'
});

module.exports = postalRouter;