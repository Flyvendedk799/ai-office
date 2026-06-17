const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMemoryKb, formatPercent, sparkline } = require('../src/util/format');

test('formats memory from KB into human units', () => {
  assert.equal(formatMemoryKb(0), '-');
  assert.equal(formatMemoryKb(512), '512K');
  assert.equal(formatMemoryKb(2048), '2.0M');
  assert.equal(formatMemoryKb(204800), '200M');
  assert.equal(formatMemoryKb(2 * 1024 * 1024), '2.00G');
});

test('formats cpu/mem percentages with adaptive precision', () => {
  assert.equal(formatPercent(0), '0.0%');
  assert.equal(formatPercent(3.456), '3.5%');
  assert.equal(formatPercent(42.1), '42%');
  assert.equal(formatPercent(180), '180%');
  assert.equal(formatPercent(undefined), '-');
});

test('renders a sparkline scaled to the series max', () => {
  const out = sparkline([0, 5, 10]);
  assert.equal(out.length, 3);
  assert.equal(out[0], '▁');
  assert.equal(out[2], '█');
});

test('sparkline trims to the requested width', () => {
  const out = sparkline([1, 2, 3, 4, 5, 6, 7, 8], { width: 4 });
  assert.equal(out.length, 4);
});

test('sparkline tolerates empty input', () => {
  assert.equal(sparkline([]), '');
  assert.equal(sparkline(undefined), '');
});
