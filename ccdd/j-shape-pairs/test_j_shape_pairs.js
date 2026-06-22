// Property-tests congelados — contrato j-shape-pairs.
// Oraculo independiente: construye tools sinteticas con schema conocido y verifica el conjunto
// de pares reportado por jShapePairs (y la integracion con gate). NO importa internos del target.
const test = require('node:test');
const assert = require('node:assert');
const { jShapePairs, gate } = require('../../ccdd/aacs-lite');

// Schema base: { a:string, b:number } — dos tools con este schema tienen arbol identico.
function schema(extra) {
    const s = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } };
    return extra ? Object.assign(s, extra) : s;
}
const tool = (id, inputSchema) => ({ id, entity: 'e', inputSchema });

test('par identico sin declarar -> se cuenta', () => {
    const pairs = jShapePairs([tool('x', schema()), tool('y', schema())]);
    assert.deepStrictEqual(pairs, ['x~y']);
});

test('par identico con x-variant-of mutuo -> se exime', () => {
    const a = tool('x', schema({ 'x-variant-of': 'y' }));
    const b = tool('y', schema({ 'x-variant-of': 'x' }));
    assert.deepStrictEqual(jShapePairs([a, b]), []);
});

test('par identico con x-variant-of unilateral -> sigue contando', () => {
    // solo a declara a b; b no declara a a -> no mutuo -> cuenta.
    const a = tool('x', schema({ 'x-variant-of': 'y' }));
    const b = tool('y', schema());
    assert.deepStrictEqual(jShapePairs([a, b]), ['x~y']);
});

test('par identico con x-variant-of mutuo pero ids cruzados incorrectos -> sigue contando', () => {
    // a->y (correcto) pero b->z (no es a) -> no mutuo -> cuenta.
    const a = tool('x', schema({ 'x-variant-of': 'y' }));
    const b = tool('y', schema({ 'x-variant-of': 'z' }));
    assert.deepStrictEqual(jShapePairs([a, b]), ['x~y']);
});

test('tools de forma distinta -> no forman par', () => {
    const a = tool('x', schema());
    const b = tool('y', { type: 'object', properties: { a: { type: 'boolean' } } });
    assert.deepStrictEqual(jShapePairs([a, b]), []);
});

test('triangulo de 3 identicas con x-variant-of mutuo en array -> ningun par', () => {
    const a = tool('a', schema({ 'x-variant-of': ['b', 'c'] }));
    const b = tool('b', schema({ 'x-variant-of': ['a', 'c'] }));
    const c = tool('c', schema({ 'x-variant-of': ['a', 'b'] }));
    assert.deepStrictEqual(jShapePairs([a, b, c]), []);
});

test('triangulo de 3 identicas sin declarar -> 3 pares', () => {
    const a = tool('a', schema());
    const b = tool('b', schema());
    const c = tool('c', schema());
    assert.deepStrictEqual(jShapePairs([a, b, c]), ['a~b', 'a~c', 'b~c']);
});

test('integracion gate: colision sin eximir -> finding j-shape ERROR', () => {
    const r = gate([tool('x', schema()), tool('y', schema())]);
    assert.strictEqual(r.verdict, 'FAIL');
    assert.ok(r.findings.some((f) => f.rule === 'j-shape' && f.sev === 'ERROR'));
});

test('integracion gate: colision con exencion mutua -> sin finding j-shape', () => {
    const a = tool('x', schema({ 'x-variant-of': 'y' }));
    const b = tool('y', schema({ 'x-variant-of': 'x' }));
    const r = gate([a, b]);
    assert.strictEqual(r.verdict, 'PASS');
    assert.ok(!r.findings.some((f) => f.rule === 'j-shape'));
});

test('x-variant-of acepta string y array indistintamente para la exencion', () => {
    // a en string, b en array (que incluye a a) -> mutuo -> exime.
    const a = tool('x', schema({ 'x-variant-of': 'y' }));
    const b = tool('y', schema({ 'x-variant-of': ['x'] }));
    assert.deepStrictEqual(jShapePairs([a, b]), []);
});