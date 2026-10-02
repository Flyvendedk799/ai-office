const test = require('node:test');
const assert = require('node:assert/strict');
const { AnimationClock } = require('../src/tui/motion');
const { createOfficeScene, toSession, SEATS, route, renderOffice } = require('../src/tui/office');
const { MAP, MAP_W, MAP_H } = require('../src/tui/floor');
const { textWidth } = require('../src/util/text');
const { renderDashboard } = require('../src/tui/dashboard');

function agent(extra = {}) { return { id: 'a', deskIndex: 0, title: 'Auth refactor', toolName: 'Codex', status: 'active', appearAt: 0, statusChangedAt: 0, ...extra }; }
const session = (value, now) => toSession(value, 0, now);
const plain = (value) => value.replace(/\{[^}]*\}/g, '');

test('pause resumes from the same animation time through repeated toggles', () => {
  const clock = new AnimationClock(1000);
  clock.toggle(2000);
  assert.equal(clock.time(12_000), 2000);
  clock.toggle(12_000);
  assert.equal(clock.time(12_000), 2000);
  assert.equal(clock.time(12_090), 2090);
  clock.toggle(13_000); clock.toggle(23_000);
  assert.equal(clock.time(23_000), 3000);
});

test('status changes redirect walking from the current cell without a teleport', () => {
  const scene = createOfficeScene();
  let value = agent();
  let previous;
  for (let now = 10_000; now <= 30_000; now += 33) {
    if (now > 11_000 && now < 18_000) value = agent({ status: 'idle', previousStatus: 'active', statusChangedAt: 11_000 });
    else if (now >= 18_000) value = agent({ status: 'active', previousStatus: 'idle', statusChangedAt: 18_000 });
    const [current] = scene.sync([session(value, now)], now);
    if (previous) assert.ok(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y) <= 1, `jump at ${now}`);
    assert.ok(['.', '+', 'n'].includes(MAP[current.y][current.x]), `actor entered furniture at ${now}`);
    previous = current;
  }
  assert.equal(previous.x, SEATS[0].x);
  assert.equal(previous.y, SEATS[0].y);
});

test('agent filtering preserves desks and actors are removed after expiry', () => {
  const scene = createOfficeScene();
  const all = [agent(), agent({ id: 'b', deskIndex: 4 })];
  renderOffice({ agents: all, allAgents: all, width: 100, height: 32, now: 10_000, scene });
  const before = { ...scene.actors.get('b') };
  renderOffice({ agents: [all[1]], allAgents: all, width: 100, height: 32, now: 10_000, scene });
  assert.equal(scene.actors.get('b').x, before.x);
  assert.equal(scene.actors.get('b').y, before.y);
  renderOffice({ agents: [all[1]], allAgents: [all[1]], width: 100, height: 32, now: 10_000, scene });
  assert.equal(scene.actors.has('a'), false);
});

test('every desk can be reached through adjacent walkable floor cells', () => {
  assert.equal(MAP.length, MAP_H);
  assert.ok(MAP.every((row) => row.length === MAP_W));
  for (const seat of SEATS) {
    const path = route({ x: 1, y: 19 }, seat);
    assert.deepEqual(path.at(-1), seat);
    path.forEach((point, index) => {
      assert.ok(['.', '+', 'n'].includes(MAP[point.y][point.x]));
      if (index) assert.equal(Math.abs(point.x - path[index - 1].x) + Math.abs(point.y - path[index - 1].y), 1);
    });
  }
});

test('reduced motion freezes scenery but keeps current tasks live', () => {
  const scene = createOfficeScene();
  const options = { agents: [agent()], width: 100, height: 32, scene, reducedMotion: true };
  const first = renderOffice({ ...options, now: 10_000 });
  assert.equal(first, renderOffice({ ...options, now: 12_000 }));
  assert.match(plain(renderOffice({ ...options, agents: [agent({ currentTask: 'write integration tests' })], now: 12_000 })), /write integration tests/);
});

test('office respects exact dimensions and follows selection beyond the first floor', () => {
  const agents = Array.from({ length: 30 }, (_, index) => agent({ id: String(index), title: `agent-${index}`, deskIndex: index }));
  for (const [width, height] of [[18, 5], [44, 16], [80, 24], [90, 30], [130, 34]]) {
    const frame = plain(renderOffice({ agents, width, height, now: 10_000, selectedId: '25' }));
    assert.equal(frame.split('\n').length, height);
    assert.ok(frame.split('\n').every((line) => line.length === width), `${width}x${height}`);
    if (width >= 90) assert.match(frame, /floor 3/);
  }
});

test('wide session titles and terminal control characters cannot break the layout', () => {
  const agents = [agent({ title: '重构认证 🔧', currentTask: '\x1b[31mfix {red-fg} permissions', projectPath: '/work/项目/设置' })];
  for (const render of [renderOffice, renderDashboard]) {
    const frame = plain(render({ agents, width: 130, height: 34, now: 10_000 }));
    assert.ok(!frame.includes('\x1b'));
    assert.match(frame, /重构认证/);
    assert.ok(frame.split('\n').every((line) => textWidth(line) === 130));
  }
});
