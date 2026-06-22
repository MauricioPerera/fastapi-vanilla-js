// Property-tests congelados — contrato pr-sanitize-branch.
// Oráculo independiente: solo importa PullError del target.
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeBranchName, PullError } = require('../../lib/pulls');

test('rama simple valida', () => {
  assert.strictEqual(sanitizeBranchName('main'), 'main');
  assert.strictEqual(sanitizeBranchName('feature-foo'), 'feature-foo');
});

test('rama anidada con / valida', () => {
  assert.strictEqual(sanitizeBranchName('feature/foo'), 'feature/foo');
  assert.strictEqual(sanitizeBranchName('feature/foo/bar'), 'feature/foo/bar');
});

test('trima espacios extremos', () => {
  assert.strictEqual(sanitizeBranchName('  main  '), 'main');
});

test('.. lanza invalid_branch (rango git)', () => {
  for (const bad of ['..bad', 'a..b', 'main..dev']) {
    assert.throws(() => sanitizeBranchName(bad), (e) => e instanceof PullError && e.code === 'invalid_branch');
  }
});

test('- inicial lanza invalid_branch (opcion git)', () => {
  assert.throws(() => sanitizeBranchName('-x'), (e) => e instanceof PullError && e.code === 'invalid_branch');
});

test('metacaracteres de refspec lanzan invalid_branch', () => {
  for (const bad of ['feat:ure', 'a~b', 'a^b', 'a?b', 'a*b', 'a[b', 'a]b', 'a{b', 'a(b', 'a)b', 'a,b', 'a@b', 'a\\b', 'a"b', "a'b", 'a b']) {
    assert.throws(() => sanitizeBranchName(bad), (e) => e instanceof PullError && e.code === 'invalid_branch', 'fallo para: ' + bad);
  }
});

test('vacio y no-string lanzan invalid_branch', () => {
  assert.throws(() => sanitizeBranchName(''), (e) => e instanceof PullError && e.code === 'invalid_branch');
  assert.throws(() => sanitizeBranchName('   '), (e) => e instanceof PullError && e.code === 'invalid_branch');
  assert.throws(() => sanitizeBranchName(42), (e) => e instanceof PullError && e.code === 'invalid_branch');
  assert.throws(() => sanitizeBranchName(null), (e) => e instanceof PullError && e.code === 'invalid_branch');
});