// Property-tests congelados — contrato repo-parse-last-commit.
const test = require('node:test');
const assert = require('node:assert');
const { parseLastCommitOutput } = require('../../lib/gitRepos');

test('vacío o espacios -> null', () => {
  assert.strictEqual(parseLastCommitOutput(''), null);
  assert.strictEqual(parseLastCommitOutput('   \n  '), null);
});

test('parsea commit de 4 campos', () => {
  const out = 'abc123|Ana|2026-06-21T10:00:00+00:00|fix bug';
  assert.deepStrictEqual(parseLastCommitOutput(out), {
    hash: 'abc123', author: 'Ana', date: '2026-06-21T10:00:00+00:00', message: 'fix bug'
  });
});

test('message con pipes se reconstruye', () => {
  const out = 'h|A|d|msg|con|pipe';
  assert.deepStrictEqual(parseLastCommitOutput(out), {
    hash: 'h', author: 'A', date: 'd', message: 'msg|con|pipe'
  });
});

test('menos de 4 campos -> null', () => {
  assert.strictEqual(parseLastCommitOutput('a|b|c'), null);
  assert.strictEqual(parseLastCommitOutput('a|b'), null);
  assert.strictEqual(parseLastCommitOutput('a'), null);
});

test('no muta la entrada', () => {
  const s = 'abc123|Ana|d|fix bug';
  parseLastCommitOutput(s);
  assert.strictEqual(s, 'abc123|Ana|d|fix bug');
});