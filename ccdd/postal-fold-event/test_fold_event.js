'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { foldEvent } = require('../../lib/postal');

function st() { return { issues: {}, pulls: {}, workflows: {}, runs: {}, messages: [], counts: {} }; }

test('no muta el estado de entrada', () => {
  const s0 = st();
  foldEvent(s0, { kind: 'agent.message', from: 'a', to: [], body: { text: 'h' }, created_at: 'x' });
  assert.strictEqual(s0.messages.length, 0);
  assert.strictEqual(Object.keys(s0.counts).length, 0);
});
test('cuenta incrementada', () => {
  const s = foldEvent(st(), { kind: 'agent.message', from: 'a', to: [], body: { text: 'h' }, created_at: 'x' });
  assert.strictEqual(s.counts['agent.message'], 1);
});
test('issue.created crea issue', () => {
  const s = foldEvent(st(), { kind: 'issue.created', body: { number: 1, title: 't' } });
  assert.ok(s.issues['1']);
});
test('conserva estado previo', () => {
  let s = foldEvent(st(), { kind: 'issue.created', body: { number: 1, title: 't' } });
  s = foldEvent(s, { kind: 'agent.message', from: 'a', to: [], body: { text: 'h' }, created_at: 'x' });
  assert.ok(s.issues['1']);
  assert.strictEqual(s.messages.length, 1);
});
test('pr.created crea pull y conserva issues previos', () => {
  let s = foldEvent(st(), { kind: 'issue.created', body: { number: 1, title: 't' } });
  s = foldEvent(s, { kind: 'pr.created', body: { number: 1, title: 't', head: 'f', base: 'm' } });
  assert.ok(s.pulls['1']);
  assert.ok(s.issues['1'], 'issues previo conservado');
  assert.strictEqual(s.counts['pr.created'], 1);
});
test('no muta el estado de entrada al plegar pr', () => {
  const s0 = st();
  foldEvent(s0, { kind: 'pr.created', body: { number: 1, title: 't', head: 'f', base: 'm' } });
  assert.strictEqual(Object.keys(s0.pulls).length, 0);
  assert.strictEqual(Object.keys(s0.counts).length, 0);
});
