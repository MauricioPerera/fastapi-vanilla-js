'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildTimeline } = require('../../lib/postal');

test('un entry por evento', () => {
  const t = buildTimeline([{ kind: 'agent.message', from: 'a', seq: 0, created_at: 'x', body: { text: 'h' } }]);
  assert.strictEqual(t.length, 1);
});
test('summary issue.created contiene el numero', () => {
  const t = buildTimeline([{ kind: 'issue.created', from: 'a', seq: 0, created_at: 'x', body: { number: 1, title: 't' } }]);
  assert.ok(t[0].summary.indexOf('issue #1') >= 0);
});
test('summary agent.message contiene el texto', () => {
  const t = buildTimeline([{ kind: 'agent.message', from: 'a', seq: 0, created_at: 'x', body: { text: 'hola' } }]);
  assert.ok(t[0].summary.indexOf('hola') >= 0);
});
test('conserva seq kind from at', () => {
  const t = buildTimeline([{ kind: 'agent.message', from: 'alice', seq: 3, created_at: '2026', body: { text: 'x' } }]);
  assert.strictEqual(t[0].seq, 3);
  assert.strictEqual(t[0].kind, 'agent.message');
  assert.strictEqual(t[0].from, 'alice');
  assert.strictEqual(t[0].at, '2026');
});
test('summary pr.created contiene el numero', () => {
  const t = buildTimeline([{ kind: 'pr.created', from: 'a', seq: 0, created_at: 'x', body: { number: 2, title: 't' } }]);
  assert.ok(t[0].summary.indexOf('PR #2') >= 0);
});
test('summary pr.merged contiene el sha', () => {
  const t = buildTimeline([{ kind: 'pr.merged', from: 'a', seq: 0, created_at: 'x', body: { number: 2, mergeCommitSha: 'deadbeef' } }]);
  assert.ok(t[0].summary.indexOf('deadbeef') >= 0);
  assert.ok(t[0].summary.indexOf('mergeado') >= 0);
});
test('summary workflow.defined contiene el nombre', () => {
  const t = buildTimeline([{ kind: 'workflow.defined', from: 'a', seq: 0, created_at: 'x', body: { name: 'ci' } }]);
  assert.ok(t[0].summary.indexOf('ci') >= 0);
  assert.ok(t[0].summary.indexOf('workflow') >= 0);
});
test('summary run.completed contiene status y exitCode', () => {
  const t = buildTimeline([{ kind: 'run.completed', from: 'a', seq: 0, created_at: 'x', body: { status: 'success', exitCode: 0 } }]);
  assert.ok(t[0].summary.indexOf('success') >= 0);
  assert.ok(t[0].summary.indexOf('exit=0') >= 0);
});
test('summary run.started contiene workflow', () => {
  const t = buildTimeline([{ kind: 'run.started', from: 'a', seq: 0, created_at: 'x', body: { workflow: 'ci' } }]);
  assert.ok(t[0].summary.indexOf('ci') >= 0);
});
