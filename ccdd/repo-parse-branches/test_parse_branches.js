// Property-tests congelados — contrato repo-parse-branches.
const test = require('node:test');
const assert = require('node:assert');
const { parseBranchesOutput } = require('../../lib/gitRepos');

test('vacío -> []', () => {
  assert.deepStrictEqual(parseBranchesOutput(''), []);
  assert.deepStrictEqual(parseBranchesOutput('   '), []);
});

test('una rama', () => {
  assert.deepStrictEqual(parseBranchesOutput('main\n'), ['main']);
  assert.deepStrictEqual(parseBranchesOutput('main'), ['main']);
});

test('varias ramas conservan orden', () => {
  assert.deepStrictEqual(parseBranchesOutput('main\ndev\nfeature/x\n'), ['main', 'dev', 'feature/x']);
});

test('trima espacios extremos', () => {
  assert.deepStrictEqual(parseBranchesOutput('  main  \n  dev \n'), ['main', 'dev']);
});

test('descarta líneas vacías intermedias', () => {
  assert.deepStrictEqual(parseBranchesOutput('main\n\nfeature/x\n'), ['main', 'feature/x']);
});