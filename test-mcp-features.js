// Suite de las features MCP del sistema (lib/mcp-features.js), ejercitadas en proceso
// vía FastMCP._handleMessage (sin spawnear). Cubre handlers de tools/resources/prompts
// que la suite stdio (test-mcp.js) no tocaba.
const test = require('node:test');
const assert = require('node:assert');
const { FastMCP } = require('./lib/fastmcp');
const { registerSystemFeatures } = require('./lib/mcp-features');
const db = require('./dependencies/db');

const mcp = new FastMCP('test-features', { version: '0.0.0' });
registerSystemFeatures(mcp);

let _id = 0;
const rpc = async (method, params) => {
  const res = await mcp._handleMessage({ jsonrpc: '2.0', id: ++_id, method, params });
  if (res && res.error) {
    throw new Error(`RPC Error [${method}]: ${res.error.message} (code: ${res.error.code})`);
  }
  return res;
};
const callTool = async (name, args = {}) => {
  const res = await rpc('tools/call', { name, arguments: args });
  return JSON.parse(res.result.content[0].text);
};

test('tool document_insert + document_find (ida y vuelta sobre el DocStore)', async (t) => {
  t.after(() => { try { db.drop('mcpfeat_docs'); } catch (e) { /* ya eliminada */ } });
  const ins = await callTool('document_insert', { collection: 'mcpfeat_docs', document: { titulo: 'hola', n: 1 } });
  assert.strictEqual(ins.estado, 'EXITOSO');
  assert.ok(ins.documento._id);

  const found = await callTool('document_find', { collection: 'mcpfeat_docs', filter: { titulo: 'hola' } });
  assert.strictEqual(found.estado, 'EXITOSO');
  assert.ok(found.conteo >= 1);
  assert.ok(found.documentos.some(d => d.titulo === 'hola'));
});

test('tool consultar_estado_api → INACTIVO si no hay servidor REST', async () => {
  // Puerto sin servidor: el fetch falla y se toma la rama INACTIVO.
  const out = await callTool('consultar_estado_api', { puerto: 59999 });
  assert.strictEqual(out.estado, 'INACTIVO');
});

test('tool list_vector_collections → estado EXITOSO', async () => {
  const out = await callTool('list_vector_collections', { quantization: 'float32' });
  assert.strictEqual(out.estado, 'EXITOSO');
  assert.ok(Array.isArray(out.colecciones));
});

test('resource documentos://colecciones devuelve JSON', async () => {
  const res = await rpc('resources/read', { uri: 'documentos://colecciones' });
  const report = JSON.parse(res.result.contents[0].text);
  assert.strictEqual(typeof report, 'object');
});

test('resource vectores://colecciones devuelve JSON por cuantización', async () => {
  const res = await rpc('resources/read', { uri: 'vectores://colecciones' });
  const report = JSON.parse(res.result.contents[0].text);
  assert.ok('float32' in report);
});

test('prompt analisis_semantico entrega plantilla', async () => {
  const res = await rpc('prompts/get', { name: 'analisis_semantico', arguments: {} });
  const text = res.result.messages[0].content.text;
  assert.ok(/sem[aá]ntic/i.test(text));
});
