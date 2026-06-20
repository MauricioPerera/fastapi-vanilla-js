// Suite unitaria del Vector Store: cubre math utils, los 4 backends (Float32/Int8/
// Binary/Polar), BM25, búsqueda híbrida, IVF y el tokenizer — código de producción
// (vector search) que la batería de integración apenas ejercitaba.
const test = require('node:test');
const assert = require('node:assert');
const {
  VectorStore, QuantizedStore, BinaryQuantizedStore, PolarQuantizedStore,
  IVFIndex, BM25Index, HybridSearch, SimpleTokenizer, MemoryStorageAdapter,
  normalize, cosineSim, euclideanDist, dotProduct, manhattanDist,
} = require('./lib/js-vector-store');

// ── Math utils (puras) ──────────────────────────────────────────────────────
test('math: cosineSim, dotProduct, euclideanDist, manhattanDist, normalize', () => {
  assert.ok(Math.abs(cosineSim([1, 0], [1, 0], 2) - 1) < 1e-9);   // idénticos -> 1
  assert.ok(Math.abs(cosineSim([1, 0], [0, 1], 2) - 0) < 1e-9);   // ortogonales -> 0
  assert.strictEqual(dotProduct([1, 2], [3, 4], 2), 11);
  assert.ok(Math.abs(euclideanDist([0, 0], [3, 4], 2) - 5) < 1e-9);
  assert.ok(Math.abs(manhattanDist([0, 0], [3, 4], 2) - 7) < 1e-9);
  const n = normalize([3, 4]);
  assert.ok(Math.abs(Math.hypot(n[0], n[1]) - 1) < 1e-9);          // longitud unitaria
});

// ── Backends: el vector idéntico a la consulta rankea primero ───────────────
function backendRanksExact(Store, dim) {
  const s = new Store(new MemoryStorageAdapter(), dim);
  // Relleno -1 (no 0): BinaryQuantizedStore cuantiza por signo (>=0 -> 1), así que con 0
  // ambos vectores serían todo-1s idénticos y el test no discriminaría.
  const a = Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : -1));
  const b = Array.from({ length: dim }, (_, i) => (i === 1 ? 1 : -1));
  s.set('c', 'a', a, { tag: 'A' });
  s.set('c', 'b', b, { tag: 'B' });
  assert.strictEqual(s.count('c'), 2);
  const res = s.search('c', a, 2, 0, 'cosine');
  assert.strictEqual(res[0].id, 'a');                 // el más cercano a `a` es `a`
  assert.ok(res[0].score >= res[1].score);            // orden por score desc
  return s;
}

test('VectorStore (Float32): set/search/count', () => {
  const s = backendRanksExact(VectorStore, 8);
  assert.strictEqual(s.search('c', [1,-1,-1,-1,-1,-1,-1,-1], 5, 0, 'cosine', { tag: 'A' }).length, 1); // filtro
});
test('QuantizedStore (Int8): set/search', () => { backendRanksExact(QuantizedStore, 8); });
test('BinaryQuantizedStore: set/search', () => { backendRanksExact(BinaryQuantizedStore, 8); });
test('PolarQuantizedStore: set/search', () => { backendRanksExact(PolarQuantizedStore, 8); });

test('VectorStore: métricas euclidean y manhattan', () => {
  const s = new VectorStore(new MemoryStorageAdapter(), 3);
  s.set('c', 'x', [0, 0, 0]);
  s.set('c', 'y', [10, 10, 10]);
  assert.strictEqual(s.search('c', [0.1, 0, 0], 1, 0, 'euclidean')[0].id, 'x');
  assert.strictEqual(s.search('c', [0.1, 0, 0], 1, 0, 'manhattan')[0].id, 'x');
});

// ── BM25 ────────────────────────────────────────────────────────────────────
test('BM25Index: addDocument + search relevante', () => {
  const bm = new BM25Index();
  bm.addDocument('c', 'd1', 'el gato negro duerme');
  bm.addDocument('c', 'd2', 'el perro corre rapido');
  bm.addDocument('c', 'd3', 'gato y perro juegan');
  assert.strictEqual(bm.count('c'), 3);
  const res = bm.search('c', 'gato', 5);
  const ids = res.map(r => r.id);
  assert.ok(ids.includes('d1') && ids.includes('d3')); // contienen "gato"
  assert.ok(!ids.includes('d2'));                       // d2 no
});

// ── Búsqueda híbrida (dense + BM25) ─────────────────────────────────────────
test('HybridSearch: combina vector y texto', () => {
  const store = new VectorStore(new MemoryStorageAdapter(), 4);
  const bm = new BM25Index();
  store.set('c', 'd1', [1, 0, 0, 0]); bm.addDocument('c', 'd1', 'manzana roja');
  store.set('c', 'd2', [0, 1, 0, 0]); bm.addDocument('c', 'd2', 'banana amarilla');
  const hybrid = new HybridSearch(store, bm);
  const res = hybrid.search('c', [1, 0, 0, 0], 'manzana', 5);
  assert.ok(Array.isArray(res) && res.length > 0);
  assert.strictEqual(res[0].id, 'd1'); // vector + texto coinciden en d1
});

// ── IVF (K-means) ───────────────────────────────────────────────────────────
test('IVFIndex: build + search devuelve vecinos', () => {
  const store = new VectorStore(new MemoryStorageAdapter(), 4);
  // dos clústeres claros
  store.set('c', 'a1', [1, 1, 0, 0]);
  store.set('c', 'a2', [1, 0.9, 0, 0]);
  store.set('c', 'a3', [0.9, 1, 0, 0]);
  store.set('c', 'b1', [0, 0, 1, 1]);
  store.set('c', 'b2', [0, 0, 1, 0.9]);
  store.set('c', 'b3', [0, 0, 0.9, 1]);
  const idx = new IVFIndex(store, 2, 1); // numProbes=1: solo el clúster más cercano (valida la poda IVF)
  idx.build('c');
  const res = idx.search('c', [1, 1, 0, 0], 3);
  assert.ok(res.length > 0);
  assert.ok(res.map(r => r.id).some(id => id.startsWith('a'))); // recupera el clúster correcto
});

// ── Tokenizer ───────────────────────────────────────────────────────────────
test('SimpleTokenizer: lowercase y split alfanumérico', () => {
  const tok = new SimpleTokenizer();
  const tokens = tok.tokenize('Hola, MUNDO! foo_bar 123');
  assert.ok(tokens.includes('hola'));
  assert.ok(tokens.includes('mundo'));
  assert.ok(tokens.every(t => t === t.toLowerCase()));
});
