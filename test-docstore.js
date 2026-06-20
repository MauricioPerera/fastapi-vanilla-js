// Suite unitaria del Document Store: cubre los caminos refactorizados en la sesión
// que la batería de integración NO ejercitaba (applyUpdate, lookups por índice,
// Cursor sort/skip/limit/proyección, AggregationPipeline, Auth._validatePassword,
// Table._validate). Convierte verificaciones ad-hoc previas en cobertura de CI.
const test = require('node:test');
const assert = require('node:assert');
const { DocStore, MemoryStorageAdapter, Auth, Table } = require('./lib/js-doc-store');

const freshCol = (name = 'c') => new DocStore(new MemoryStorageAdapter()).collection(name);

// ── applyUpdate (operadores de update) ──────────────────────────────────────
test('applyUpdate: $set / $inc / $push / $pull / $unset / $rename', () => {
  const c = freshCol();
  c.insert({ _id: '1', n: 1, tags: ['a'], cat: 'x', drop: 1 });

  c.update({ _id: '1' }, { $set: { n: 10 } });
  assert.strictEqual(c.findById('1').n, 10);

  c.update({ _id: '1' }, { $inc: { n: 5 } });
  assert.strictEqual(c.findById('1').n, 15);

  c.update({ _id: '1' }, { $push: { tags: 'b' } });
  assert.deepStrictEqual(c.findById('1').tags, ['a', 'b']);

  c.update({ _id: '1' }, { $pull: { tags: 'a' } });
  assert.deepStrictEqual(c.findById('1').tags, ['b']);

  c.update({ _id: '1' }, { $unset: { drop: '' } });
  assert.strictEqual(c.findById('1').drop, undefined);

  c.update({ _id: '1' }, { $rename: { cat: 'categoria' } });
  assert.strictEqual(c.findById('1').categoria, 'x');
  assert.strictEqual(c.findById('1').cat, undefined);
});

test('applyUpdate: $push crea array si el campo no existe', () => {
  const c = freshCol();
  c.insert({ _id: '1' });
  c.update({ _id: '1' }, { $push: { list: 'a' } });
  assert.deepStrictEqual(c.findById('1').list, ['a']);
});

test('applyUpdate: update sin operador mergea (Object.assign) y preserva _id', () => {
  // Nota: un update sin operadores $ NO reemplaza el doc completo (a diferencia de Mongo);
  // hace Object.assign sobre el doc existente, conservando los campos no mencionados.
  const c = freshCol();
  c.insert({ _id: '1', a: 1, b: 2 });
  c.update({ _id: '1' }, { a: 9 });
  const doc = c.findById('1');
  assert.strictEqual(doc._id, '1'); // _id preservado
  assert.strictEqual(doc.a, 9);     // campo mencionado: sobrescrito
  assert.strictEqual(doc.b, 2);     // campo no mencionado: conservado (merge, no replace)
});

// ── Lookups por índice (_tryIndexLookup → _hashIndexLookup / _sortedIndexLookup) ──
test('hash index: $eq directo y $in (con dedup de duplicados)', () => {
  const c = freshCol();
  c.createIndex('cat'); // hash
  c.insert({ _id: '1', cat: 'a' });
  c.insert({ _id: '2', cat: 'a' });
  c.insert({ _id: '3', cat: 'b' });

  assert.deepStrictEqual(c.find({ cat: 'a' }).toArray().map(d => d._id).sort(), ['1', '2']);
  assert.deepStrictEqual(c.find({ cat: { $eq: 'b' } }).toArray().map(d => d._id), ['3']);

  // $in con valor duplicado: cada doc una sola vez
  const ids = c.find({ cat: { $in: ['a', 'a', 'b'] } }).toArray().map(d => d._id).sort();
  assert.deepStrictEqual(ids, ['1', '2', '3']);
});

test('sorted index: rango ($gte/$gt/$lte/$lt), $eq y escalar', () => {
  const c = freshCol();
  c.createIndex('age', { type: 'sorted' });
  for (const [id, age] of [['1', 10], ['2', 20], ['3', 30]]) c.insert({ _id: id, age });

  assert.deepStrictEqual(c.find({ age: { $gte: 20 } }).toArray().map(d => d._id).sort(), ['2', '3']);
  assert.deepStrictEqual(c.find({ age: { $gt: 20 } }).toArray().map(d => d._id), ['3']);
  assert.deepStrictEqual(c.find({ age: { $lte: 20 } }).toArray().map(d => d._id).sort(), ['1', '2']);
  assert.deepStrictEqual(c.find({ age: { $lt: 20 } }).toArray().map(d => d._id), ['1']);
  assert.deepStrictEqual(c.find({ age: { $eq: 30 } }).toArray().map(d => d._id), ['3']);
  assert.deepStrictEqual(c.find({ age: 10 }).toArray().map(d => d._id), ['1']);
});

// ── Cursor: sort / skip / limit / proyección ────────────────────────────────
test('Cursor: sort en memoria (asc/desc), skip y limit', () => {
  const c = freshCol();
  for (const [id, n] of [['1', 30], ['2', 10], ['3', 20]]) c.insert({ _id: id, n });
  assert.deepStrictEqual(c.find({}).sort({ n: 1 }).toArray().map(d => d._id), ['2', '3', '1']);
  assert.deepStrictEqual(c.find({}).sort({ n: -1 }).toArray().map(d => d._id), ['1', '3', '2']);
  assert.deepStrictEqual(c.find({}).sort({ n: 1 }).limit(2).toArray().map(d => d._id), ['2', '3']);
  assert.deepStrictEqual(c.find({}).sort({ n: 1 }).skip(1).toArray().map(d => d._id), ['3', '1']);
});

test('Cursor: fast-path por índice ordenado (mismo resultado)', () => {
  const c = freshCol();
  c.createIndex('n', { type: 'sorted' });
  for (const [id, n] of [['1', 30], ['2', 10], ['3', 20]]) c.insert({ _id: id, n });
  assert.deepStrictEqual(c.find({}).sort({ n: 1 }).limit(2).toArray().map(d => d._id), ['2', '3']);
  assert.deepStrictEqual(c.find({}).sort({ n: -1 }).toArray().map(d => d._id), ['1', '3', '2']);
});

test('Cursor: proyección include (con _id por defecto y _id:0) y exclude', () => {
  const c = freshCol();
  c.insert({ _id: '1', a: 1, b: 2, c: 3 });
  assert.deepStrictEqual(c.find({ _id: '1' }).project({ a: 1 }).toArray()[0], { _id: '1', a: 1 });
  assert.deepStrictEqual(c.find({ _id: '1' }).project({ a: 1, _id: 0 }).toArray()[0], { a: 1 });
  assert.deepStrictEqual(c.find({ _id: '1' }).project({ b: 0 }).toArray()[0], { _id: '1', a: 1, c: 3 });
});

// ── AggregationPipeline ─────────────────────────────────────────────────────
test('aggregate: group con todos los acumuladores + $sum:1', () => {
  const c = freshCol();
  c.insert({ _id: '1', r: 'N', amount: 100 });
  c.insert({ _id: '2', r: 'N', amount: 50 });
  c.insert({ _id: '3', r: 'S', amount: 200 });
  const out = c.aggregate().group('r', {
    total: { $sum: 'amount' }, avg: { $avg: 'amount' }, n: { $count: true },
    cnt: { $sum: 1 }, mn: { $min: 'amount' }, mx: { $max: 'amount' },
    list: { $push: 'amount' }, first: { $first: 'amount' }, last: { $last: 'amount' }
  }).sort({ _id: 1 }).toArray();
  assert.deepStrictEqual(out[0], { _id: 'N', total: 150, avg: 75, n: 2, cnt: 2, mn: 50, mx: 100, list: [100, 50], first: 100, last: 50 });
  assert.deepStrictEqual(out[1], { _id: 'S', total: 200, avg: 200, n: 1, cnt: 1, mn: 200, mx: 200, list: [200], first: 200, last: 200 });
});

test('aggregate: match + sort + skip + limit', () => {
  const c = freshCol();
  for (const [id, n] of [['1', 1], ['2', 2], ['3', 3], ['4', 4]]) c.insert({ _id: id, n, keep: n % 2 === 0 });
  const out = c.aggregate().match({ keep: true }).sort({ n: -1 }).skip(1).limit(1).toArray();
  assert.deepStrictEqual(out.map(d => d._id), ['2']);
});

test('aggregate: project (include/exclude), unwind y lookup', () => {
  const db = new DocStore(new MemoryStorageAdapter());
  const orders = db.collection('orders');
  const users = db.collection('users');
  users.insert({ _id: 'u1', name: 'Ana', secret: 'x' });
  orders.insert({ _id: 'o1', userId: 'u1', tags: ['a', 'b'], extra: 9 });

  assert.deepStrictEqual(orders.aggregate().match({ _id: 'o1' }).project({ userId: 1 }).toArray()[0], { _id: 'o1', userId: 'u1' });
  assert.deepStrictEqual(orders.aggregate().match({ _id: 'o1' }).unwind('tags').toArray().map(d => d.tags), ['a', 'b']);

  const joined = orders.aggregate().match({ _id: 'o1' })
    .lookup({ from: 'users', localField: 'userId', foreignField: '_id', as: 'user', single: true })
    .toArray()[0];
  assert.strictEqual(joined.user.name, 'Ana');
});

// ── Auth._validatePassword (políticas) ──────────────────────────────────────
test('Auth._validatePassword: cada política y caso válido', () => {
  const db = new DocStore(new MemoryStorageAdapter());
  const auth = new Auth(db, {
    secret: 's',
    passwordPolicy: { minLength: 8, maxLength: 20, requireUppercase: true, requireLowercase: true, requireDigit: true, requireSymbol: true }
  });
  // Validar el mensaje esperado evita falsos positivos (que salte otro error inesperado).
  const fails = (pw, expected) => assert.throws(() => auth._validatePassword(pw), expected);
  fails('Ab1!', /at least 8 characters/);                 // < minLength
  fails('A'.repeat(25) + 'b1!', /at most 20 characters/); // > maxLength
  fails('abcdef1!', /uppercase/);                          // sin mayúscula
  fails('ABCDEF1!', /lowercase/);                          // sin minúscula
  fails('Abcdefg!', /digit/);                              // sin dígito
  fails('Abcdefg1', /symbol/);                             // sin símbolo
  fails(12345678, /must be a string/);                     // no string
  assert.doesNotThrow(() => auth._validatePassword('Abcdef1!')); // cumple todo
});

test('Auth._validatePassword: customValidator', () => {
  const db = new DocStore(new MemoryStorageAdapter());
  const auth = new Auth(db, { secret: 's', passwordPolicy: { minLength: 1, customValidator: (pw) => pw === 'nope' ? 'prohibido' : null } });
  assert.throws(() => auth._validatePassword('nope'), /prohibido/);
  assert.doesNotThrow(() => auth._validatePassword('ok'));
});

// ── Table._validate ─────────────────────────────────────────────────────────
test('Table._validate: required, tipo, update e ignorados', () => {
  const db = new DocStore(new MemoryStorageAdapter());
  const t = new Table(db, 'prod', { columns: [
    { name: 'nombre', type: 'text', required: true },
    { name: 'precio', type: 'number' },
    { name: 'id', type: 'autonumber' },
  ]});
  assert.throws(() => t._validate({ precio: 5 }, false), /nombre/);              // required ausente
  assert.throws(() => t._validate({ nombre: 'x', precio: 'abc' }, false), /precio/); // tipo inválido
  assert.doesNotThrow(() => t._validate({ nombre: 'x', precio: 5 }, false));     // válido
  assert.doesNotThrow(() => t._validate({ precio: 9 }, true));                   // update no exige required
});
