// Property-tests congelados — contrato repo-sanitize-name.
// Oráculo independiente: solo importa la función bajo test.
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeRepoName, RepoError } = require('../../lib/gitRepos');

test('nombres validos pasan y se triman', () => {
  assert.strictEqual(sanitizeRepoName('mi-repo'), 'mi-repo');
  assert.strictEqual(sanitizeRepoName('  mi-repo  '), 'mi-repo');
  assert.strictEqual(sanitizeRepoName('a'), 'a');
  assert.strictEqual(sanitizeRepoName('My.Repo_2'), 'My.Repo_2');
  assert.strictEqual(sanitizeRepoName('repo.dev'), 'repo.dev');
});

test('vacío o solo espacios lanza invalid_name', () => {
  assert.throws(() => sanitizeRepoName(''), (e) => e instanceof RepoError && e.code === 'invalid_name');
  assert.throws(() => sanitizeRepoName('   '), (e) => e instanceof RepoError && e.code === 'invalid_name');
});

test('path traversal lanza invalid_name', () => {
  assert.throws(() => sanitizeRepoName('../etc'), (e) => e.code === 'invalid_name');
  assert.throws(() => sanitizeRepoName('..'), (e) => e.code === 'invalid_name');
  assert.throws(() => sanitizeRepoName('a/b'), (e) => e.code === 'invalid_name');
  assert.throws(() => sanitizeRepoName('a\\b'), (e) => e.code === 'invalid_name');
  assert.throws(() => sanitizeRepoName('a\0b'), (e) => e.code === 'invalid_name');
});

test('no-string lanza invalid_name', () => {
  assert.throws(() => sanitizeRepoName(42), (e) => e.code === 'invalid_name');
  assert.throws(() => sanitizeRepoName(null), (e) => e.code === 'invalid_name');
  assert.throws(() => sanitizeRepoName(undefined), (e) => e.code === 'invalid_name');
});

test('caracteres fuera del patron lanzan invalid_name', () => {
  assert.throws(() => sanitizeRepoName('repo con espacio'), (e) => e.code === 'invalid_name');
  assert.throws(() => sanitizeRepoName('repo$'), (e) => e.code === 'invalid_name');
  assert.throws(() => sanitizeRepoName('.hidden'), (e) => e.code === 'invalid_name');
});

test('no muta la entrada', () => {
  const original = '  mi-repo  ';
  sanitizeRepoName(original);
  assert.strictEqual(original, '  mi-repo  ');
});