const test = require('node:test');
const assert = require('node:assert/strict');
const { statusFromProcess, deriveSessionName, makeCandidate } = require('../src/detection/helpers');

test('running and sleeping processes both count as active', () => {
  assert.equal(statusFromProcess({ stat: 'R' }), 'active');
  assert.equal(statusFromProcess({ stat: 'R+' }), 'active');
  assert.equal(statusFromProcess({ stat: 'S' }), 'active');
  assert.equal(statusFromProcess({ stat: 'S+' }), 'active');
  assert.equal(statusFromProcess({ stat: 'Ss' }), 'active');
});

test('stopped and zombie processes are not active', () => {
  assert.equal(statusFromProcess({ stat: 'T' }), 'unknown');
  assert.equal(statusFromProcess({ stat: 'Z' }), 'unknown');
});

test('session name falls back to the tty when there is no project', () => {
  const result = deriveSessionName({ pid: 1011, name: 'claude', tty: 's000', command: 'claude' }, undefined, undefined, undefined);
  assert.strictEqual(result.name, 'claude@s000');
  assert.strictEqual(result.isReal, true);
});

test('session name falls back to the pid when there is no tty', () => {
  const result = deriveSessionName({ pid: 1011, name: 'claude', command: 'claude' }, undefined, undefined, undefined);
  assert.strictEqual(result.name, 'claude-1011');
  assert.strictEqual(result.isReal, false);
});

test('candidate carries tty and an active status from process state', () => {
  const proc = {
    pid: 1011,
    ppid: 1,
    stat: 'S+',
    command: 'claude --dangerously-skip-permissions',
    name: 'claude',
    tty: 's001',
    elapsedMs: 1000,
    startedAt: 0,
  };
  const candidate = makeCandidate(proc, { toolKey: 'claude-code', toolName: 'Claude Code', fallbackPrefix: 'claude' });
  assert.equal(candidate.tty, 's001');
  assert.equal(candidate.statusHint, 'active');
  assert.equal(candidate.sessionName, 'claude@s001');
});
