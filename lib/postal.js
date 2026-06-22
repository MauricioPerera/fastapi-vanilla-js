// lib/postal.js
// MEMORIA DE PROYECTO / INTERACCION ENTRE AGENTES — capa Postal sobre el local-GitHub.
//
// Reutiliza el MODELO de Postal (https://github.com/MauricioPerera/postal) porteado a CJS
// nativo zero-dep: evento firmado append-only, hash-chain por autor (seq + prev), id y
// path deterministas, y projector que replega eventos -> estado + timeline legible.
//
// Layout (un archivo inmutable = un evento, append-only):
//   <eventsDir>/<repo>/<YYYY>/<MM>/<DD>/<id>.json
//
// El firmado ECDSA es OPCIONAL/best-effort en esta iteracion: si `input.identity` llega
// con claves WebCrypto, se firma el evento (canonical, ECDSA P-256); si no, `sig` es null
// y el gate lo admite. Los invariantes OBLIGATORIOS son append-only + cadena prev-hash +
// seq-por-autor-desde-0 + id/path deterministas.

const fs = require('fs');
const path = require('path');
const { sanitizeRepoName, RepoError } = require('./gitRepos');

const VERSION = 1;
const subtle = globalThis.crypto && globalThis.crypto.subtle;
const enc = new TextEncoder();

class PostalError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

// --- Helpers internos (no son targets de contrato; cubiertos transitivamente) ---

function pathExists(p) {
    return fs.promises.access(p).then(() => true, () => false);
}

function nowIso() { return new Date().toISOString(); }

function randomHex(n) {
    const b = new Uint8Array(n);
    globalThis.crypto.getRandomValues(b);
    return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// base64url SIN padding (charset [A-Za-z0-9_-]). Helper de derivacion de identidad.
function toBase64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Vista firmable: todo menos la firma (coherente con Postal `signedView`).
function signedView(ev) {
    const { sig, ...rest } = ev;
    return rest;
}

// Best-effort: firma ECDSA P-256 sobre canonical(signedView(ev)). Si no hay crypto o
// identity, devuelve null (admitido por el gate esta iteracion).
async function signEvent(ev, identity) {
    if (!subtle || !identity || !identity.signPrivateJwk) return null;
    try {
        const priv = await subtle.importKey('jwk', identity.signPrivateJwk,
            { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
        const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv,
            enc.encode(canonical(signedView(ev))));
        return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        return null;
    }
}

// Lee el arbol de eventos de un repo (todos los *.json bajo <eventsDir>/<repo>/...).
// No es target de contrato (helper de listEvents/readChainTip).
async function readAllEvents(repoName, eventsDir) {
    const root = path.join(eventsDir, repoName);
    if (!await pathExists(root)) return [];
    let entries = [];
    try {
        entries = await fs.promises.readdir(root, { recursive: true, withFileTypes: true });
    } catch (e) {
        return [];
    }
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.json'))
        .map((e) => path.join(e.parentPath || root, e.name));
    const events = [];
    for (const f of files) {
        try {
            const raw = await fs.promises.readFile(f, 'utf8');
            events.push({ event: JSON.parse(raw), path: f });
        } catch (e) { /* archivo corrupto: se ignora en lectura */ }
    }
    return events;
}

// shallow copy del estado plegable (helper interno, cubierto transitivamente).
function shallowCopyState(state) {
    return {
        issues: state.issues ? { ...state.issues } : {},
        pulls: state.pulls ? { ...state.pulls } : {},
        workflows: state.workflows ? { ...state.workflows } : {},
        runs: state.runs ? { ...state.runs } : {},
        messages: state.messages ? state.messages.slice() : [],
        counts: state.counts ? { ...state.counts } : {}
    };
}

// Aplicadores por kind (helpers internos, cubiertos transitivamente via foldEvent).
const BODY_APPLIERS = {
    'issue.created': (s, ev) => {
        const b = ev.body || {};
        if (b.number == null) return;
        s.issues[String(b.number)] = { number: b.number, title: b.title || '', state: b.state || 'open', body: b.body || '' };
    },
    'issue.state_changed': (s, ev) => {
        const b = ev.body || {};
        if (b.number == null || !s.issues[String(b.number)]) return;
        s.issues[String(b.number)] = { ...s.issues[String(b.number)], state: b.state };
    },
    'issue.commented': (s, ev) => {
        const b = ev.body || {};
        if (b.number == null || !s.issues[String(b.number)]) return;
        const cur = s.issues[String(b.number)];
        s.issues[String(b.number)] = { ...cur, comments: (cur.comments || 0) + 1 };
    },
    'agent.message': (s, ev) => {
        const b = ev.body || {};
        s.messages.push({ from: ev.from, to: ev.to || [], text: b.text || '', at: ev.created_at });
    },
    'pr.created': (s, ev) => {
        const b = ev.body || {};
        if (b.number == null) return;
        s.pulls[String(b.number)] = { number: b.number, title: b.title || '', state: b.state || 'open', head: b.head || '', base: b.base || '', mergeCommitSha: null };
    },
    'pr.state_changed': (s, ev) => {
        const b = ev.body || {};
        if (b.number == null || !s.pulls[String(b.number)]) return;
        s.pulls[String(b.number)] = { ...s.pulls[String(b.number)], state: b.state };
    },
    'pr.commented': (s, ev) => {
        const b = ev.body || {};
        if (b.number == null || !s.pulls[String(b.number)]) return;
        const cur = s.pulls[String(b.number)];
        s.pulls[String(b.number)] = { ...cur, comments: (cur.comments || 0) + 1 };
    },
    'pr.merged': (s, ev) => {
        const b = ev.body || {};
        if (b.number == null || !s.pulls[String(b.number)]) return;
        s.pulls[String(b.number)] = { ...s.pulls[String(b.number)], state: 'merged', mergeCommitSha: b.mergeCommitSha || null };
    },
    'workflow.defined': (s, ev) => {
        const b = ev.body || {};
        if (!b.name) return;
        s.workflows[String(b.name)] = { name: b.name, trigger: b.trigger || '' };
    },
    'run.started': (s, ev) => {
        const b = ev.body || {};
        if (!b.runId) return;
        s.runs[String(b.runId)] = { id: b.runId, workflow: b.workflow || '', event: b.event || '', status: 'running' };
    },
    'run.completed': (s, ev) => {
        const b = ev.body || {};
        if (!b.runId) return;
        const cur = s.runs[String(b.runId)] || { id: b.runId, workflow: b.workflow || '', event: b.event || '' };
        s.runs[String(b.runId)] = { ...cur, status: b.status || 'unknown', exitCode: b.exitCode };
    }
};

// --- Funciones core (targets de contrato CCDD) ---

// canonical: JSON determinista (claves ordenadas) para hashing/firma estable.
function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

// agentId determinista anclado a la clave publica: base64url(SHA-256(SPKI DER)).
// Misma clave publica -> mismo agentId (fingerprint verificable).
async function deriveAgentId(publicSpkiBuffer) {
    const h = new Uint8Array(await subtle.digest('SHA-256', publicSpkiBuffer));
    return toBase64url(h);
}

// Hex string -> Uint8Array (helper de verificacion de firma).
function fromHex(hex) {
    const a = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
    return a;
}

// Pre-condicion de verificacion: hay crypto, evento con sig hex no vacio y clave publica.
function canVerifySig(ev, publicJwk) {
    return !!(subtle && ev && typeof ev.sig === 'string' && ev.sig && publicJwk);
}

// Verifica la firma ECDSA P-256 de un evento contra la clave publica del autor.
// Firma sobre canonical(signedView(ev)). False (sin lanzar) en cualquier caso erroneo.
async function verifyEventSignature(ev, publicJwk) {
    if (!canVerifySig(ev, publicJwk)) return false;
    try {
        const pub = await subtle.importKey('jwk', publicJwk,
            { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub,
            fromHex(ev.sig), enc.encode(canonical(signedView(ev))));
    } catch (e) {
        return false;
    }
}

// Hash de un evento almacenado (canonical bytes, incluye su firma). Es el valor que el
// SIGUIENTE evento del mismo autor referencia como `prev`.
async function eventHash(ev) {
    const bytes = enc.encode(canonical(ev));
    const h = new Uint8Array(await subtle.digest('SHA-256', bytes));
    return Array.from(h).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Id determinista: <created_at con :/. -> ->_<from>_<rnd>. El path es verificable sin abrir.
function makeEventId(createdAt, from, rnd) {
    return String(createdAt).replace(/[:.]/g, '-') + '_' + String(from) + '_' + String(rnd);
}

// Path determinista del archivo de evento: <eventsDir>/<repo>/<YYYY>/<MM>/<DD>/<id>.json.
function eventFilePath(repoName, ev, eventsDir) {
    const safe = sanitizeRepoName(repoName);
    const d = new Date(ev.created_at);
    const p = (n) => String(n).padStart(2, '0');
    const y = String(d.getUTCFullYear());
    const m = p(d.getUTCMonth() + 1);
    const dd = p(d.getUTCDate());
    return path.join(eventsDir, safe, y, m, dd, ev.id + '.json');
}

// Tip de la cadena de un autor en un repo: { seq, prev } para el proximo evento.
// seq parte de 0; prev es el hash del ultimo evento del autor (null si es el primero).
async function readChainTip(repoName, eventsDir, agentId) {
    const safe = sanitizeRepoName(repoName);
    const items = await readAllEvents(safe, eventsDir);
    const own = items.filter((it) => it.event && it.event.from === agentId);
    if (!own.length) return { seq: 0, prev: null };
    let last = own[0];
    for (const it of own) {
        if (Number(it.event.seq) > Number(last.event.seq)) last = it;
    }
    return { seq: Number(last.event.seq) + 1, prev: await eventHash(last.event) };
}

// Valida el input de appendEvent. Lanza PostalError('invalid_input') si algo falla.
// Puro (no toca disco). Devuelve el input normalizado sin mutar.
function validateEventInput(input) {
    if (!input || typeof input !== 'object') throw new PostalError('invalid_input', 'input requerido');
    if (typeof input.kind !== 'string' || !input.kind.trim()) throw new PostalError('invalid_input', 'kind requerido');
    if (typeof input.agentId !== 'string' || !input.agentId.trim()) throw new PostalError('invalid_input', 'agentId requerido');
    if (input.payload !== undefined && (input.payload === null || typeof input.payload !== 'object')) {
        throw new PostalError('invalid_input', 'payload debe ser objeto');
    }
    return input;
}

// Append un evento inmutable encadenado al log del repo. Devuelve el evento persistido.
// input = { kind, agentId, payload, to?, identity?, created_at?, rnd? }.
async function appendEvent(repoName, eventsDir, input) {
    const safe = sanitizeRepoName(repoName);
    validateEventInput(input);
    const createdAt = input.created_at || nowIso();
    const rnd = input.rnd || randomHex(8);
    const tip = await readChainTip(safe, eventsDir, input.agentId);
    const ev = {
        v: VERSION,
        kind: input.kind,
        from: input.agentId,
        to: Array.isArray(input.to) ? [...input.to].sort() : [],
        created_at: createdAt,
        id: makeEventId(createdAt, input.agentId, rnd),
        seq: tip.seq,
        prev: tip.prev,
        body: input.payload || {},
        sig: null
    };
    ev.sig = await signEvent(ev, input.identity);
    const file = eventFilePath(safe, ev, eventsDir);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(ev, null, 2), 'utf8');
    return ev;
}

// --- Registro de identidades (provenance) ---

// Lee el archivo de identidades de un repo. Helper: {identities:[]} si no existe/corrupto.
async function readIdentitiesFile(file) {
    try {
        const raw = await fs.promises.readFile(file, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.identities) ? parsed : { identities: [] };
    } catch (e) {
        return { identities: [] };
    }
}

// Carga el registro de identidades de un repo como Map(agentId -> publicJwk).
// Helper (no es target de contrato; cubierto transitivamente por verifyChains/replay).
async function loadIdentities(repoName, identitiesDir) {
    const safe = sanitizeRepoName(repoName);
    const file = path.join(identitiesDir, safe + '.json');
    const reg = await readIdentitiesFile(file);
    const map = new Map();
    for (const it of reg.identities) {
        if (it && it.agentId && it.publicJwk) map.set(it.agentId, it.publicJwk);
    }
    return map;
}

// Carga las identidades genesis como Map(agentId -> genesisEntry {agentId, publicJwk,
// activated_at}). activated_at = registered_at (instante de la clave genesis).
// Helper (no es target de contrato; cubierto transitivamente por replayEvents/buildKeyLedger).
async function loadGenesisMap(repoName, identitiesDir) {
    const safe = sanitizeRepoName(repoName);
    const file = path.join(identitiesDir, safe + '.json');
    const reg = await readIdentitiesFile(file);
    const map = new Map();
    for (const it of reg.identities) {
        if (it && it.agentId && it.publicJwk) {
            map.set(it.agentId, { agentId: it.agentId, publicJwk: it.publicJwk, activated_at: it.registered_at });
        }
    }
    return map;
}

// Reconstruye el historial de claves de una identidad (estado vigente de claves) plegando
// sus eventos identity.rotated/revoked sobre la genesis. Devuelve el KeyState {agentId, keys}
// o null si la identidad no esta registrada.
// Helper (no es target de contrato; compone loadGenesisMap + listEvents + foldIdentityEvents).
async function getKeyHistory(repoName, eventsDir, identitiesDir, agentId) {
    const safe = sanitizeRepoName(repoName);
    const genesisMap = await loadGenesisMap(safe, identitiesDir);
    const genesis = genesisMap.get(agentId);
    if (!genesis) return null;
    const events = await listEvents(safe, eventsDir);
    const identityEvents = events.filter((ev) => ev.from === agentId && (ev.kind === 'identity.rotated' || ev.kind === 'identity.revoked'));
    return await foldIdentityEvents(genesis, identityEvents);
}

// Lista las identidades registradas de un repo. Helper para el endpoint REST.
async function listIdentities(repoName, identitiesDir) {
    const safe = sanitizeRepoName(repoName);
    const file = path.join(identitiesDir, safe + '.json');
    const reg = await readIdentitiesFile(file);
    return reg.identities.map((it) => ({
        agentId: it.agentId, publicKeyJwk: it.publicJwk, registered_at: it.registered_at
    }));
}

// Genera un keypair ECDSA P-256 nuevo (glue WebCrypto). NO persiste; la privada se
// devuelve al llamante una sola vez. El agentId se deriva en registerIdentity.
async function generateIdentity() {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    return {
        privateKeyJwk: await subtle.exportKey('jwk', kp.privateKey),
        publicKeyJwk: await subtle.exportKey('jwk', kp.publicKey)
    };
}

// Registra la clave publica de un agente en el repo (append-only). Deriva el agentId
// desde la propia clave (fingerprint). Idempotente. Solo persiste la PUBLICA.
async function registerIdentity(repoName, identitiesDir, publicJwk) {
    const safe = sanitizeRepoName(repoName);
    const pub = await subtle.importKey('jwk', publicJwk,
        { name: 'ECDSA', namedCurve: 'P-256' }, true, []);
    const spki = await subtle.exportKey('spki', pub);
    const agentId = await deriveAgentId(spki);
    const file = path.join(identitiesDir, safe + '.json');
    const reg = await readIdentitiesFile(file);
    const existing = reg.identities.find((it) => it.agentId === agentId);
    if (existing) return { agentId, publicKeyJwk: existing.publicJwk, existed: true };
    reg.identities.push({ agentId, publicJwk, registered_at: nowIso() });
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(reg, null, 2), 'utf8');
    return { agentId, publicKeyJwk: publicJwk, existed: false };
}

// Lista los eventos de un repo, opcionalmente filtrados. filters = { kind?, from?, since? }.
async function listEvents(repoName, eventsDir, filters) {
    const safe = sanitizeRepoName(repoName);
    const items = await readAllEvents(safe, eventsDir);
    let events = items.map((it) => it.event);
    const f = filters || {};
    if (f.kind) events = events.filter((e) => e.kind === f.kind);
    if (f.from) events = events.filter((e) => e.from === f.from);
    if (f.since) events = events.filter((e) => String(e.created_at) >= String(f.since));
    events.sort((a, b) => {
        const ta = String(a.created_at), tb = String(b.created_at);
        if (ta !== tb) return ta < tb ? -1 : 1;
        return String(a.id) < String(b.id) ? -1 : 1;
    });
    return events;
}

// Verifica la cadena de UN autor: seq contiguo desde 0 y prev = hash del evento previo.
// Devuelve [{ from, seq, reasons[] }]. list ya pertenece a un solo `from`.
async function verifyAuthorChain(from, list) {
    const sorted = list.slice().sort((a, b) => a.seq - b.seq);
    let expected = 0, prevHash = null;
    const failures = [];
    for (const ev of sorted) {
        const reasons = [];
        if (ev.seq !== expected) reasons.push('chain-gap(expected ' + expected + ', got ' + ev.seq + ')');
        if ((ev.prev || null) !== prevHash) reasons.push('chain-prev-mismatch');
        if (reasons.length) failures.push({ from, seq: ev.seq, reasons });
        prevHash = await eventHash(ev);
        expected = ev.seq + 1;
    }
    return failures;
}

// Verifica las cadenas por autor: seq contiguo desde 0 y prev = hash del evento previo.
// Ademas, si `identities` (Map agentId -> publicJwk) esta presente, verifica el gate de
// provenance por evento (firma ECDSA contra la clave publica registrada del autor).
// Devuelve [{ from, seq, reasons[] }]. Sin identities -> solo cadena (backward-compat).
function groupByAuthor(events) {
    const groups = new Map();
    for (const ev of events) {
        if (!ev || typeof ev.seq !== 'number') continue;
        if (!groups.has(ev.from)) groups.set(ev.from, []);
        groups.get(ev.from).push(ev);
    }
    return groups;
}

// True si el evento trae firma hex (string no vacio). Helper de provenance.
function hasSig(ev) {
    return !!(ev && ev.sig && typeof ev.sig === 'string');
}

// Motivos cuando el evento NO trae firma. Helper de provenance.
function noSigReasons(registered) {
    return registered ? ['unsigned-registered-author'] : [];
}

// Motivos de rechazo de provenance de un evento contra el registro de identidades.
// identities ausente -> [] (legacy). Reglas: unknown-author / bad-signature /
// unsigned-registered-author. Devuelve [] si el evento es admisible.
async function verifyEventProvenance(ev, identities) {
    if (!identities) return [];
    const registered = identities.has(ev.from);
    if (!hasSig(ev)) return noSigReasons(registered);
    if (!registered) return ['unknown-author'];
    const ok = await verifyEventSignature(ev, identities.get(ev.from));
    if (!ok) return ['bad-signature'];
    return [];
}

// Provenance de todos los eventos de un autor. Helper (cubierto via verifyChains).
async function verifyGroupProvenance(from, list, identities) {
    if (!identities) return [];
    const failures = [];
    for (const ev of list) {
        const reasons = await verifyEventProvenance(ev, identities);
        if (reasons.length) failures.push({ from, seq: ev.seq, reasons });
    }
    return failures;
}

async function verifyChains(events, identities, keyLedger) {
    const groups = groupByAuthor(events);
    const failures = [];
    
    for (const [from, list] of groups) {
        const authorChainFailures = await verifyAuthorChain(from, list);
        for (const f of authorChainFailures) failures.push(f);
        
        const provenanceFailures = keyLedger 
            ? await verifyGroupTemporalProvenance(from, list, keyLedger)
            : await verifyGroupProvenance(from, list, identities);
            
        for (const f of provenanceFailures) failures.push(f);
    }
    
    return failures;
}

async function verifyGroupTemporalProvenance(from, list, keyLedger) {
    const failures = [];
    for (const ev of list) {
        const reasons = await verifyTemporalProvenance(ev, keyLedger);
        if (reasons.length > 0) {
            failures.push({ from, seq: ev.seq, reasons });
        }
    }
    return failures;
}

// Aplica el body de un evento sobre el estado (muta `next` in-place). Dispatch por kind.
// Helper puro respecto al estado (no toca disco). Exportado para gateo independiente.
function applyBody(next, ev) {
    const applier = BODY_APPLIERS[ev.kind];
    if (applier) applier(next, ev);
    return next;
}

// Pliega un evento sobre el estado (puro: devuelve NUEVO estado). Cuenta + applyBody.
function foldEvent(state, ev) {
    const next = shallowCopyState(state);
    next.counts[ev.kind] = (next.counts[ev.kind] || 0) + 1;
    applyBody(next, ev);
    return next;
}

// Resumenes por kind (helpers internos, cubiertos transitivamente via buildTimeline).
const TIMELINE_SUMMARY = {
    'issue.created': (b) => 'issue #' + b.number + ' creado: ' + (b.title || ''),
    'issue.state_changed': (b) => 'issue #' + b.number + ' -> ' + b.state,
    'issue.commented': () => 'comentario en issue',
    'agent.message': (b) => 'mensaje: ' + (b.text || '').slice(0, 80),
    'pr.created': (b) => 'PR #' + b.number + ' creado: ' + (b.title || ''),
    'pr.state_changed': (b) => 'PR #' + b.number + ' -> ' + b.state,
    'pr.commented': () => 'comentario en PR',
    'pr.merged': (b) => 'PR #' + b.number + ' mergeado ' + (b.mergeCommitSha || ''),
    'workflow.defined': (b) => 'workflow definido: ' + (b.name || ''),
    'run.started': (b) => 'run iniciado: ' + (b.workflow || ''),
    'run.completed': (b) => 'run ' + (b.status || '') + ' exit=' + (b.exitCode != null ? b.exitCode : '?')
};

// Convierte eventos en una timeline legible para un agente (puro).
function buildTimeline(events) {
    return events.map((ev) => {
        const b = ev.body || {};
        const mk = TIMELINE_SUMMARY[ev.kind];
        return { seq: ev.seq, kind: ev.kind, from: ev.from, at: ev.created_at, summary: mk ? mk(b) : ev.kind };
    });
}

// Projector: lee el log, verifica las cadenas, pliega los eventos validos -> estado +
// timeline. Devuelve { state, timeline, total, verified, failures }.
// Si identitiesDir esta presente, carga el registro de identidades y aplica el gate de
// provenance (firma ECDSA) ademas de la cadena; si no, solo cadena (backward-compat).
async function loadIdentitiesMaybe(repoName, identitiesDir) {
    return identitiesDir ? await loadIdentities(repoName, identitiesDir) : undefined;
}

async function replayEvents(repoName, eventsDir, identitiesDir) {
  const safe = sanitizeRepoName(repoName);
  const events = await listEvents(safe, eventsDir);
  const identities = await loadIdentitiesMaybe(safe, identitiesDir);
  
  const { failures, verified } = await processVerification(events, identities, safe, identitiesDir);
  const state = buildState(verified);
  const timeline = buildTimeline(verified);
  
  return { 
    state, 
    timeline, 
    total: events.length, 
    verified: verified.length, 
    failures 
  };
}

async function processVerification(events, identities, safe, identitiesDir) {
  let keyLedger;
  if (identities && identitiesDir) {
    const genesisMap = await loadGenesisMap(safe, identitiesDir);
    const identityEvents = events.filter(ev => 
      ev.kind === 'identity.rotated' || ev.kind === 'identity.revoked'
    );
    keyLedger = await buildKeyLedger(genesisMap, identityEvents);
  }
  
  const failures = await verifyChains(events, identities, keyLedger);
  const badSeqs = new Set(failures.map(f => f.from + ':' + f.seq));
  const verified = events.filter(ev => 
    typeof ev.seq !== 'number' || !badSeqs.has(ev.from + ':' + ev.seq)
  );
  
  return { failures, verified };
}

function buildState(verifiedEvents) {
  let state = { 
    issues: {}, 
    pulls: {}, 
    workflows: {}, 
    runs: {}, 
    messages: [], 
    counts: {} 
  };
  
  for (const ev of verifiedEvents) {
    state = foldEvent(state, ev);
  }
  
  return state;
}

// --- Rotacion / revocacion de claves (identidad anclada a la clave genesis) ---
// Stubs: la implementacion la provee el implementador CCDD (ver ccdd/postal-*).

// Aplicar un evento identity.rotated sobre el estado de claves de una identidad.
function applyRotation(keyState, ev) {
    const activeKey = keyState.keys.find(k => k.status === 'active' && k.superseded_at === null);
    if (!activeKey) return keyState;

    const effective = ev.body.effective_at || ev.created_at;
    const newKey = {
        publicJwk: ev.body.newPublicJwk,
        activated_at: effective,
        status: 'active',
        superseded_at: null,
        revoked_at: null
    };

    const updatedActiveKey = {
        ...activeKey,
        status: 'rotated',
        superseded_at: effective
    };

    const newKeys = keyState.keys.map(k => k === activeKey ? updatedActiveKey : k).concat(newKey);
    return { ...keyState, keys: newKeys };
}

// Aplicar un evento identity.revoked sobre el estado de claves de una identidad.
function findTargetKey(keys, targetPublicJwk) {
    if (!targetPublicJwk) return keys.findIndex(k => k.status === 'active' && k.superseded_at === null);
    return keys.findIndex(k => JSON.stringify(k.publicJwk) === JSON.stringify(targetPublicJwk));
}

function applyRevocation(keyState, ev) {
    const keys = keyState.keys;
    const targetIdx = findTargetKey(keys, ev.body.targetPublicJwk);
    
    if (targetIdx === -1) return keyState;
    
    const targetKey = keys[targetIdx];
    const revokedAt = ev.body.revoked_at || ev.created_at;
    
    if (targetKey.revoked_at !== null) return keyState;
    
    const newKeys = [...keys];
    newKeys[targetIdx] = {
        ...targetKey,
        status: 'revoked',
        revoked_at: revokedAt
    };
    
    return { ...keyState, keys: newKeys };
}

// Resolver la clave vigente de una identidad en un instante.
// Función auxiliar para verificar si una clave cubre un timestamp
function keyCoversTimestamp(key, timestamp) {
  return key.activated_at <= timestamp &&
         (key.superseded_at === null || timestamp <= key.superseded_at) &&
         (key.revoked_at === null || timestamp <= key.revoked_at);
}

// Función auxiliar para encontrar la clave activa
function findActiveKey(keys, timestamp) {
  let activeKey = null;
  
  for (const key of keys) {
    if (keyCoversTimestamp(key, timestamp)) {
      if (!activeKey || key.activated_at > activeKey.activated_at) {
        activeKey = key;
      }
    }
  }
  
  return activeKey;
}

function resolveActiveKeyAt(keyState, timestamp) {
  if (!keyState || !Array.isArray(keyState.keys)) {
    return null;
  }
  
  return findActiveKey(keyState.keys, timestamp);
}

// Motivos de invalidez temporal de una clave firmante en un instante.
function _checkRevoked(keyEntry, timestamp) {
    if (keyEntry.revoked_at && timestamp > keyEntry.revoked_at) {
        return ['revoked-key'];
    }
    return null;
}

function _checkSuperseded(keyEntry, timestamp) {
    if (keyEntry.superseded_at && timestamp > keyEntry.superseded_at) {
        return ['stale-key'];
    }
    return null;
}

function _checkFuture(keyEntry, timestamp) {
    if (timestamp < keyEntry.activated_at) {
        return ['future-key'];
    }
    return [];
}

function verifyTemporalKey(keyEntry, timestamp) {
    return _checkRevoked(keyEntry, timestamp) ||
           _checkSuperseded(keyEntry, timestamp) ||
           _checkFuture(keyEntry, timestamp);
}

// Plegar los eventos de identidad de un agente en su KeyState auto-certificante.
// Función auxiliar para procesar un evento de identidad
async function processIdentityEvent(state, ev) {
    const active = state.keys.find(k => k.status === 'active' && k.superseded_at === null);
    if (!active) return null;

    const isValid = await verifyEventSignature(ev, active.publicJwk);
    if (!isValid) return null;

    if (ev.kind === 'identity.rotated') {
        return applyRotation(state, ev);
    } else if (ev.kind === 'identity.revoked') {
        return applyRevocation(state, ev);
    }
    
    return state;
}

// Función auxiliar para ordenar eventos por created_at
function sortEvents(events) {
    return events.slice().sort((a, b) => {
        if (a.created_at < b.created_at) return -1;
        if (a.created_at > b.created_at) return 1;
        return 0;
    });
}

async function foldIdentityEvents(genesisEntry, events) {
    // Estado inicial con la clave génesis
    let state = {
        agentId: genesisEntry.agentId,
        keys: [{
            publicJwk: genesisEntry.publicJwk,
            activated_at: genesisEntry.activated_at,
            status: 'active',
            superseded_at: null,
            revoked_at: null
        }]
    };

    // Procesar eventos en orden cronológico
    const sortedEvents = sortEvents(events);
    
    for (const ev of sortedEvents) {
        const newState = await processIdentityEvent(state, ev);
        if (newState === null) break;
        state = newState;
    }

    return state;
}

async function buildKeyLedger(identities, identityEvents) {
    const ledger = new Map();
    const grouped = new Map();

    for (const event of identityEvents) {
        const agentId = event.from;
        if (!grouped.has(agentId)) grouped.set(agentId, []);
        grouped.get(agentId).push(event);
    }

    for (const [agentId, genesisEntry] of identities) {
        const events = grouped.get(agentId) || [];
        const state = await foldIdentityEvents(genesisEntry, events);
        ledger.set(agentId, state);
    }

    return ledger;
}

async function verifyTemporalProvenance(ev, keyLedger) {
    if (!keyLedger) return [];
    
    const keyState = keyLedger.get(ev.from);
    if (!keyState) return ['unknown-author'];
    
    if (!hasSig(ev)) return ['unsigned-registered-author'];
    
    for (const key of keyState.keys) {
        if (await verifyEventSignature(ev, key.publicJwk)) {
            return verifyTemporalKey(key, ev.created_at);
        }
    }
    
    return ['bad-signature'];
}

module.exports = {
    PostalError,
    applyRotation,
    applyRevocation,
    resolveActiveKeyAt,
    verifyTemporalKey,
    foldIdentityEvents,
    buildKeyLedger,
    verifyTemporalProvenance,
    verifyGroupTemporalProvenance,
    VERSION,
    canonical,
    deriveAgentId,
    verifyEventSignature,
    eventHash,
    makeEventId,
    eventFilePath,
    validateEventInput,
    readChainTip,
    appendEvent,
    registerIdentity,
    loadIdentities,
    loadGenesisMap,
    getKeyHistory,
    listIdentities,
    generateIdentity,
    listEvents,
    verifyAuthorChain,
    verifyEventProvenance,
    verifyChains,
    applyBody,
    foldEvent,
    buildTimeline,
    replayEvents
};