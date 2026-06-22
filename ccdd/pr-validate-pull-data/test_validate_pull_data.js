const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePullData, PullError } = require('../../lib/pulls');

test('validatePullData: campos validos devuelve title trimado y head/base crudos', () => {
    const out = validatePullData({ title: '  T  ', head: 'feat', base: 'main' });
    assert.equal(out.title, 'T');
    assert.equal(out.head, 'feat');
    assert.equal(out.base, 'main');
});

test('validatePullData: sin title lanza invalid_body', () => {
    assert.throws(() => validatePullData({ head: 'feat', base: 'main' }), (e) => e.code === 'invalid_body');
});

test('validatePullData: sin base lanza invalid_body', () => {
    assert.throws(() => validatePullData({ title: 'T', head: 'feat' }), (e) => e.code === 'invalid_body');
});

test('validatePullData: sin head lanza invalid_body', () => {
    assert.throws(() => validatePullData({ title: 'T', base: 'main' }), (e) => e.code === 'invalid_body');
});

test('validatePullData: data null lanza invalid_body', () => {
    assert.throws(() => validatePullData(null), (e) => e.code === 'invalid_body');
});

test('validatePullData: data no objeto lanza invalid_body', () => {
    assert.throws(() => validatePullData('x'), (e) => e.code === 'invalid_body');
});

test('validatePullData: title vacio tras trim lanza invalid_body', () => {
    assert.throws(() => validatePullData({ title: '   ', head: 'feat', base: 'main' }), (e) => e.code === 'invalid_body');
});

test('validatePullData: head vacio tras trim lanza invalid_body', () => {
    assert.throws(() => validatePullData({ title: 'T', head: '  ', base: 'main' }), (e) => e.code === 'invalid_body');
});

test('validatePullData: body extra se ignora', () => {
    const out = validatePullData({ title: 'T', head: 'feat', base: 'main', body: 'x' });
    assert.equal(out.title, 'T');
});