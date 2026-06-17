const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentStore } = require('../src/state/store');

function candidate(id, statusHint = 'active', extra = {}) {
  return {
    id,
    toolKey: 'codex-cli',
    toolName: 'Codex CLI',
    icon: 'C',
    color: 'cyan',
    sessionName: id,
    projectPath: '/tmp/project',
    projectLabel: '/tmp/project',
    pid: 100,
    pids: [100],
    command: 'codex',
    statusHint,
    startedAt: 0,
    confidence: 1,
    source: 'test',
    ...extra,
  };
}

test('tracks new agents as starting then active', () => {
  const store = new AgentStore({ startingMs: 1000, stoppedGraceMs: 5000 });
  store.update([candidate('a')], 1000);
  assert.equal(store.list()[0].status, 'starting');

  store.update([candidate('a', 'idle')], 2500);
  assert.equal(store.list()[0].status, 'idle');
  assert.equal(store.selected().id, 'a');
});

test('keeps stopped agents briefly then expires them', () => {
  const store = new AgentStore({ startingMs: 0, stoppedGraceMs: 1000 });
  store.update([candidate('a')], 1000);
  store.update([], 1200);
  assert.equal(store.list()[0].status, 'stopped');

  store.expire(2301);
  assert.equal(store.list().length, 0);
});

test('emits started, status, and stopped lifecycle events', () => {
  const store = new AgentStore({ startingMs: 0, stoppedGraceMs: 5000 });
  store.update([candidate('a', 'active')], 1000);
  store.update([candidate('a', 'idle')], 2000);
  store.update([], 3000);

  const events = store.drainEvents();
  const types = events.map((event) => event.type);
  assert.deepEqual(types, ['started', 'status', 'stopped']);
  assert.equal(events[1].previousStatus, 'active');
  assert.equal(events[1].status, 'idle');
  assert.equal(events[2].type, 'stopped');
  assert.equal(events[2].runtimeMs, 3000);

  // Draining clears the buffer.
  assert.equal(store.drainEvents().length, 0);
});

test('aggregates cpu/mem/rss totals and tracks cpu history', () => {
  const store = new AgentStore({ startingMs: 0, stoppedGraceMs: 5000 });
  store.update([
    candidate('a', 'active', { cpu: 10, mem: 1.5, rssKb: 1000 }),
    candidate('b', 'idle', { id: 'b', cpu: 5, mem: 0.5, rssKb: 500 }),
  ], 1000);

  const totals = store.totals();
  assert.equal(totals.working, 1);
  assert.equal(totals.idle, 1);
  assert.equal(totals.cpu, 15);
  assert.equal(totals.mem, 2);
  assert.equal(totals.rssKb, 1500);

  store.update([candidate('a', 'active', { cpu: 20, mem: 1.5, rssKb: 1000 })], 2000);
  const agentA = store.get('a');
  assert.deepEqual(agentA.cpuHistory, [10, 20]);
  assert.ok(store.cpuHistory.length >= 2);
});

test('caps cpu history to the configured maximum', () => {
  const store = new AgentStore({ startingMs: 0, stoppedGraceMs: 50000, maxCpuHistory: 3 });
  for (let tick = 1; tick <= 6; tick += 1) {
    store.update([candidate('a', 'active', { cpu: tick })], tick * 1000);
  }
  assert.deepEqual(store.get('a').cpuHistory, [4, 5, 6]);
});

