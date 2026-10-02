const test = require('node:test');
const assert = require('node:assert/strict');
const { Workspace, scanLabel } = require('../src/tui/workspace');
const { normalizeConfig, DEFAULT_CONFIG } = require('../src/config');
const { renderActivity } = require('../src/tui/activity');

const agent = (id, extra = {}) => ({ id, pid: 123, title: id, toolName: 'Codex', statusHint: 'active', appearAt: 0, startedAt: 0, cpu: 10, rssKb: 100, ...extra });

test('failed discovery preserves live agents and records health; recovery clears it', async () => {
  let fail = false;
  let now = 10_000;
  const workspace = new Workspace({ config: DEFAULT_CONFIG, now: () => now, discovery: { discover: async () => { if (fail) throw new Error('CIM unavailable'); return [agent('a')]; } } });
  await workspace.scan();
  fail = true; now += 2000;
  await workspace.scan();
  assert.equal(workspace.store.get('a').status, 'active');
  assert.equal(workspace.store.totals().cpu, 10);
  assert.match(scanLabel(workspace.health, now), /SCAN FAILED.*CIM unavailable/);
  assert.equal(workspace.activity[0].type, 'error');
  fail = false;
  await workspace.scan();
  assert.equal(workspace.health.error, '');
});

test('scans do not overlap and late results cannot update a closed workspace', async () => {
  let finish;
  let calls = 0;
  const workspace = new Workspace({ config: DEFAULT_CONFIG, discovery: { discover: () => { calls++; return new Promise((resolve) => { finish = resolve; }); } } });
  const pending = workspace.scan();
  await workspace.scan();
  assert.equal(calls, 1);
  workspace.closed = true;
  finish([agent('a')]);
  await pending;
  assert.equal(workspace.store.list().length, 0);
});

test('focus survives CPU reorder; no match cannot target a hidden agent', async () => {
  const workspace = new Workspace({ config: DEFAULT_CONFIG, discovery: { discover: async () => [agent('a'), agent('b', { cpu: 80 })] } });
  await workspace.scan();
  workspace.store.select('a');
  workspace.ensureSelection('dashboard');
  assert.equal(workspace.selected('dashboard').id, 'a');
  workspace.filter = 'no match';
  workspace.move(1, 'office');
  assert.equal(workspace.selected('office'), undefined);
  assert.equal(workspace.store.selectedId, undefined);
});

test('configuration clamps cadences and supports activity and reduced motion', () => {
  const config = normalizeConfig({ ...DEFAULT_CONFIG, scanIntervalMs: -1, animationFps: 1000, stoppedGraceMs: -5, defaultView: 'activity', reducedMotion: true });
  assert.equal(config.scanIntervalMs, 250);
  assert.equal(config.animationFps, 60);
  assert.equal(config.stoppedGraceMs, 0);
  assert.equal(config.defaultView, 'activity');
  assert.equal(config.reducedMotion, true);
});

test('activity survives agent expiry, filters and scrolls inside exact dimensions', () => {
  const events = Array.from({ length: 20 }, (_, index) => ({ type: 'stopped', at: index * 1000, title: `session-${index}`, toolName: 'Codex', runtimeMs: 3000 }));
  const output = renderActivity({ events, width: 44, height: 8, offset: 12 });
  assert.equal(output.split('\n').length, 8);
  assert.ok(output.split('\n').every((line) => line.length === 44));
  assert.match(output, /session-12/);
  assert.match(renderActivity({ events, filter: 'nope' }), /No events match/);
});
