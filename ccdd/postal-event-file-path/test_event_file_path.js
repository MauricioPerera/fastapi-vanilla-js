'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { eventFilePath } = require('../../lib/postal');
const { RepoError } = require('../../lib/gitRepos');

function tail(p, n) { return p.split(path.sep).slice(-n).join('/'); }

test('path con componentes UTC y id al final', () => {
  const p = eventFilePath('r', { created_at: '2026-03-04T05:06Z', id: 'id1' }, '/d');
  assert.strictEqual(tail(p, 5), 'r/2026/03/04/id1.json');
});
test('path traversal lanza invalid_name', () => {
  assert.throws(() => eventFilePath('../bad', { created_at: '2026-01-01T00:00Z', id: 'x' }, '/d'), (e) => e instanceof RepoError && e.code === 'invalid_name');
});
