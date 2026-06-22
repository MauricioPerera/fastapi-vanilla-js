'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { applyBody } = require('../../lib/postal');

function st() { return { issues: {}, pulls: {}, workflows: {}, runs: {}, messages: [], counts: {} }; }

test('issue.created crea la entrada', () => {
  const s = applyBody(st(), { kind: 'issue.created', body: { number: 1, title: 't' } });
  assert.ok(s.issues['1']);
  assert.strictEqual(s.issues['1'].state, 'open');
});
test('issue.state_changed actualiza existente', () => {
  let s = applyBody(st(), { kind: 'issue.created', body: { number: 1, title: 't' } });
  s = applyBody(s, { kind: 'issue.state_changed', body: { number: 1, state: 'closed' } });
  assert.strictEqual(s.issues['1'].state, 'closed');
});
test('agent.message agrega mensaje', () => {
  const s = applyBody(st(), { kind: 'agent.message', from: 'a', to: [], body: { text: 'h' }, created_at: 'x' });
  assert.strictEqual(s.messages.length, 1);
  assert.strictEqual(s.messages[0].text, 'h');
});
test('pr.created crea pull con mergeCommitSha null', () => {
  const s = applyBody(st(), { kind: 'pr.created', body: { number: 1, title: 't', state: 'open', head: 'feat', base: 'main' } });
  assert.ok(s.pulls['1']);
  assert.strictEqual(s.pulls['1'].head, 'feat');
  assert.strictEqual(s.pulls['1'].base, 'main');
  assert.strictEqual(s.pulls['1'].mergeCommitSha, null);
});
test('pr.state_changed actualiza pull existente', () => {
  let s = applyBody(st(), { kind: 'pr.created', body: { number: 1, title: 't', head: 'f', base: 'm' } });
  s = applyBody(s, { kind: 'pr.state_changed', body: { number: 1, state: 'closed' } });
  assert.strictEqual(s.pulls['1'].state, 'closed');
});
test('pr.commented incrementa comentarios del pull', () => {
  let s = applyBody(st(), { kind: 'pr.created', body: { number: 1, title: 't', head: 'f', base: 'm' } });
  s = applyBody(s, { kind: 'pr.commented', body: { number: 1 } });
  s = applyBody(s, { kind: 'pr.commented', body: { number: 1 } });
  assert.strictEqual(s.pulls['1'].comments, 2);
});
test('pr.merged marca merged y guarda mergeCommitSha', () => {
  let s = applyBody(st(), { kind: 'pr.created', body: { number: 1, title: 't', head: 'f', base: 'm' } });
  s = applyBody(s, { kind: 'pr.merged', body: { number: 1, mergeCommitSha: 'abc123' } });
  assert.strictEqual(s.pulls['1'].state, 'merged');
  assert.strictEqual(s.pulls['1'].mergeCommitSha, 'abc123');
});
test('workflow.defined crea workflow', () => {
  const s = applyBody(st(), { kind: 'workflow.defined', body: { name: 'ci', trigger: 'manual' } });
  assert.ok(s.workflows['ci']);
  assert.strictEqual(s.workflows['ci'].trigger, 'manual');
});
test('run.started crea run en estado running', () => {
  const s = applyBody(st(), { kind: 'run.started', body: { runId: 'r1', workflow: 'ci', event: 'manual' } });
  assert.ok(s.runs['r1']);
  assert.strictEqual(s.runs['r1'].status, 'running');
});
test('run.completed actualiza status y exitCode', () => {
  let s = applyBody(st(), { kind: 'run.started', body: { runId: 'r1', workflow: 'ci', event: 'manual' } });
  s = applyBody(s, { kind: 'run.completed', body: { runId: 'r1', status: 'success', exitCode: 0 } });
  assert.strictEqual(s.runs['r1'].status, 'success');
  assert.strictEqual(s.runs['r1'].exitCode, 0);
});
test('kind desconocido es no-op y devuelve misma ref', () => {
  const s0 = st();
  const s = applyBody(s0, { kind: 'unknown', body: {} });
  assert.strictEqual(s, s0);
  assert.strictEqual(s.messages.length, 0);
});