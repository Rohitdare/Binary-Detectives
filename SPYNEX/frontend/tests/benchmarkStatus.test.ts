import test from 'node:test';
import assert from 'node:assert/strict';
import { getBenchmarkStatusInfo } from '../src/components/common/benchmarkStatus.ts';

test('Benchmark Passed maps to Passed', () => {
  const res = getBenchmarkStatusInfo(true, false, null, 'success');
  assert.equal(res.label, 'Passed');
  assert.equal(res.explanation, 'The benchmark completed and passed the configured checks.');
  assert.equal(res.hasInfoIcon, false);
  assert.equal(res.badgeStyle.backgroundColor, '#ECFDF5');
  assert.equal(res.badgeStyle.color, '#065F46');
});

test('Truncated (result_limit_reached) maps to Partially tested with result limit explanation', () => {
  const res = getBenchmarkStatusInfo(true, true, 'result_limit_reached', 'success');
  assert.equal(res.label, 'Partially tested');
  assert.equal(res.explanation, 'The evaluation reached its result limit and may not include every candidate result.');
  assert.equal(res.hasInfoIcon, true);
  assert.equal(res.badgeStyle.backgroundColor, '#FEF3C7');
  assert.equal(res.badgeStyle.color, '#92400E');
});

test('Truncated (candidate_limit_reached) maps to Partially tested with candidate limit explanation', () => {
  const res = getBenchmarkStatusInfo(true, true, 'candidate_limit_reached', 'success');
  assert.equal(res.label, 'Partially tested');
  assert.equal(res.explanation, 'The evaluation reached its candidate limit before completing all checks.');
  assert.equal(res.hasInfoIcon, true);
  assert.equal(res.badgeStyle.backgroundColor, '#FEF3C7');
  assert.equal(res.badgeStyle.color, '#92400E');
});

test('Truncated (capped) maps to Partially tested with general processing limit explanation', () => {
  const res = getBenchmarkStatusInfo(true, true, 'capped', 'success');
  assert.equal(res.label, 'Partially tested');
  assert.equal(res.explanation, 'A processing limit stopped the evaluation early.');
  assert.equal(res.hasInfoIcon, true);
  assert.equal(res.badgeStyle.backgroundColor, '#FEF3C7');
  assert.equal(res.badgeStyle.color, '#92400E');
});

test('Truncated without reason code defaults to general processing limit explanation', () => {
  const res = getBenchmarkStatusInfo(true, true, null, 'success');
  assert.equal(res.label, 'Partially tested');
  assert.equal(res.explanation, 'A processing limit stopped the evaluation early.');
  assert.equal(res.hasInfoIcon, true);
});

test('Not Evaluable (0 alerts) maps to No results to evaluate', () => {
  const res = getBenchmarkStatusInfo(false, false, null, 'not_evaluable');
  assert.equal(res.label, 'No results to evaluate');
  assert.equal(res.explanation, 'No alerts were available to calculate meaningful benchmark metrics.');
  assert.equal(res.hasInfoIcon, false);
  assert.equal(res.badgeStyle.backgroundColor, '#F1F5F9');
  assert.equal(res.badgeStyle.color, '#475569');
});

test('Pending or not yet run maps to Ready to run', () => {
  const res = getBenchmarkStatusInfo(true, false, null, undefined);
  assert.equal(res.label, 'Ready to run');
  assert.equal(res.explanation, 'Benchmark evaluation has not been executed yet.');
  assert.equal(res.hasInfoIcon, false);
});
