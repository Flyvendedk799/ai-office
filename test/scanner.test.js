const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProcessLine } = require('../src/discovery/processScanner');

test('parses a ps line with cpu/mem/rss/tty metrics columns', () => {
  const now = 1_000_000;
  const line = '  4201   311 R    01:23  12.5  3.4  204800 s000 codex --cwd /Users/demo/work/api';
  const proc = parseProcessLine(line, now);

  assert.equal(proc.pid, 4201);
  assert.equal(proc.ppid, 311);
  assert.equal(proc.stat, 'R');
  assert.equal(proc.cpu, 12.5);
  assert.equal(proc.mem, 3.4);
  assert.equal(proc.rssKb, 204800);
  assert.equal(proc.tty, 's000');
  assert.equal(proc.command, 'codex --cwd /Users/demo/work/api');
  assert.equal(proc.name, 'codex');
  assert.equal(proc.elapsedMs, 83_000);
});

test('treats "??" tty (daemons/desktop apps) as no tty', () => {
  const proc = parseProcessLine('1 0 Ss 10:48:16 0.0 0.1 18672 ?? /sbin/launchd', 0);
  assert.equal(proc.pid, 1);
  assert.equal(proc.cpu, 0);
  assert.equal(proc.mem, 0.1);
  assert.equal(proc.rssKb, 18672);
  assert.equal(proc.tty, undefined);
  assert.equal(proc.command, '/sbin/launchd');
});

test('falls back to the legacy layout without metrics columns', () => {
  const proc = parseProcessLine('  900   1 Ss   00:10 claude --project /tmp/app', 0);
  assert.equal(proc.pid, 900);
  assert.equal(proc.command, 'claude --project /tmp/app');
  assert.equal(proc.cpu, undefined);
  assert.equal(proc.mem, undefined);
  assert.equal(proc.rssKb, undefined);
});

test('ignores malformed lines', () => {
  assert.equal(parseProcessLine('', 0), null);
  assert.equal(parseProcessLine('garbage without numbers', 0), null);
});
