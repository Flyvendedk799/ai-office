const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProcessLine } = require('../src/discovery/processScanner');
const { parseWindowsProcesses } = require('../src/discovery/windowsProcessScanner');

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

test('parses Windows CIM JSON into the common process shape', () => {
  const now = 1_000_000_000;
  const samples = new Map();
  const rows = JSON.stringify([
    { pid: 4201, ppid: 311, name: 'claude.exe', command: 'claude --dangerously-skip-permissions', rssKb: 512000, startMs: now - 60_000, cpuMs: 6_000 },
    { pid: 4, ppid: 0, name: 'System', command: '', rssKb: 48, startMs: 0, cpuMs: 0 },
  ]);
  const procs = parseWindowsProcesses(rows, now, samples, 16 * 1024 * 1024);

  assert.equal(procs.length, 2);
  assert.equal(procs[0].pid, 4201);
  assert.equal(procs[0].name, 'claude');
  assert.equal(procs[0].elapsedMs, 60_000);
  // First sample has no previous scan, so CPU% is the lifetime average.
  assert.equal(procs[0].cpu, 10);
  assert.equal(procs[0].rssKb, 512000);
  assert.equal(procs[0].tty, undefined);
  // A process with no readable command line falls back to its name.
  assert.equal(procs[1].command, 'System');
});

test('computes Windows CPU% from the delta between scans', () => {
  const samples = new Map();
  const row = (cpuMs) => JSON.stringify([
    { pid: 7, ppid: 1, name: 'codex.exe', command: 'codex', rssKb: 1000, startMs: 0, cpuMs },
  ]);
  parseWindowsProcesses(row(1000), 100_000, samples);
  const second = parseWindowsProcesses(row(2000), 102_000, samples);

  // 1000ms of CPU time over a 2000ms window = 50%.
  assert.equal(second[0].cpu, 50);
});

test('drops CPU samples for pids that disappeared', () => {
  const samples = new Map();
  parseWindowsProcesses(JSON.stringify([
    { pid: 7, ppid: 1, name: 'a.exe', command: 'a', rssKb: 1, startMs: 0, cpuMs: 100 },
    { pid: 8, ppid: 1, name: 'b.exe', command: 'b', rssKb: 1, startMs: 0, cpuMs: 100 },
  ]), 100_000, samples);
  parseWindowsProcesses(JSON.stringify([
    { pid: 7, ppid: 1, name: 'a.exe', command: 'a', rssKb: 1, startMs: 0, cpuMs: 200 },
  ]), 102_000, samples);

  assert.equal(samples.has(8), false);
  assert.equal(samples.has(7), true);
});
