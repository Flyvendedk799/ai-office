const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOfficeLayout, RoutePlanner, WorldAnimator, sequenceNames, spriteFor, spriteSize } = require('../src/tui/animation');
const { isBlocked } = require('../src/tui/animation/pathfinding');
const { renderOffice } = require('../src/tui/renderers');

function agent(overrides = {}) {
  return {
    id: 'agent-a',
    toolName: 'Codex CLI',
    sessionName: 'demo',
    pid: 100,
    color: 'cyan',
    status: 'active',
    appearAt: 0,
    ...overrides,
  };
}

function stripBlessedTags(value) {
  return String(value).replace(/\{[^}]*\}/g, '');
}

test('pathfinding routes avoid blocked desk and wall cells', () => {
  const layout = computeOfficeLayout(120, 36, 4);
  const planner = new RoutePlanner();
  const walkGrid = planner.buildWalkGrid(layout);
  const route = planner.route(layout, walkGrid, layout.entrance, layout.desks[2].zones.chair);

  assert.ok(route.length > 2);
  for (let index = 0; index < route.length; index += 1) {
    const point = route[index];
    assert.equal(isBlocked(walkGrid, point.x, point.y), false, `${point.x},${point.y} should be walkable`);
    if (index > 0) {
      const previous = route[index - 1];
      const distance = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
      assert.equal(distance, 1, `route step ${index} should be an orthogonal walk step`);
    }
  }
});

test('pathfinding uses the break room door and returns stable cached routes', () => {
  const layout = computeOfficeLayout(120, 36, 4);
  const planner = new RoutePlanner();
  const walkGrid = planner.buildWalkGrid(layout);
  const from = layout.desks[0].zones.chair;
  const to = layout.breakRoom.zones.slots[0];
  const routeA = planner.route(layout, walkGrid, from, to);
  const routeB = planner.route(layout, walkGrid, from, to);

  assert.deepEqual(routeA, routeB);
  assert.ok(routeA.some((point) => point.x === layout.breakRoom.door.x && point.y === layout.breakRoom.door.y));
});

test('world animator progresses through enter, work, break, return, and leave states', () => {
  const animator = new WorldAnimator();
  const base = agent();

  let frame = animator.buildFrame({ agents: [base], width: 120, height: 36, now: 100, selectedId: 'agent-a' });
  assert.equal(frame.agents[0].action, 'entering');

  frame = animator.buildFrame({ agents: [base], width: 120, height: 36, now: 8000, selectedId: 'agent-a' });
  assert.equal(frame.agents[0].action, 'working');

  frame = animator.buildFrame({ agents: [agent({ status: 'idle', statusChangedAt: 8000 })], width: 120, height: 36, now: 8500, selectedId: 'agent-a' });
  assert.equal(frame.agents[0].action, 'working');

  frame = animator.buildFrame({ agents: [agent({ status: 'idle', statusChangedAt: 8000 })], width: 120, height: 36, now: 11000, selectedId: 'agent-a' });
  assert.ok(['toBreak', 'coffee'].includes(frame.agents[0].action));

  frame = animator.buildFrame({ agents: [agent({ status: 'active', statusChangedAt: 11200 })], width: 120, height: 36, now: 11300, selectedId: 'agent-a' });
  assert.ok(['returning', 'working'].includes(frame.agents[0].action));

  frame = animator.buildFrame({ agents: [agent({ status: 'stopped', stoppedAt: 11400 })], width: 120, height: 36, now: 11500, selectedId: 'agent-a' });
  assert.equal(frame.agents[0].action, 'leaving');
});

test('sprite library has distinct run, work, and coffee frames within declared bounds', () => {
  const size = spriteSize();
  const sequences = sequenceNames();
  const samples = [
    spriteFor({ action: 'entering', direction: 'right', routeStartedAt: 0, actionStartedAt: 0 }, 300),
    spriteFor({ action: 'entering', direction: 'right', routeStartedAt: 0, actionStartedAt: 0 }, 430),
    spriteFor({ action: 'working', direction: 'down', routeStartedAt: 0, actionStartedAt: 0 }, 100),
    spriteFor({ action: 'working', direction: 'down', routeStartedAt: 0, actionStartedAt: 0 }, 500),
    spriteFor({ action: 'coffee', direction: 'down', routeStartedAt: 0, actionStartedAt: 0 }, 100),
    spriteFor({ action: 'coffee', direction: 'down', routeStartedAt: 0, actionStartedAt: 0 }, 350),
  ];

  assert.ok(sequences.length >= 8);
  assert.deepEqual(new Set(sequences).size, sequences.length);
  assert.deepEqual(size, { width: 5, height: 3 });
  assert.notDeepEqual(samples[0], samples[1]);
  assert.notDeepEqual(samples[2], samples[3]);
  assert.notDeepEqual(samples[4], samples[5]);
  for (const sprite of samples) {
    assert.equal(sprite.length, size.height);
    for (const line of sprite) {
      assert.equal(line.length, size.width);
    }
  }
});

test('snapshot frames stay coherent at key terminal sizes', () => {
  for (const [width, height] of [[80, 24], [100, 30], [120, 36], [80, 21], [100, 27], [120, 33]]) {
    const animator = new WorldAnimator();
    const agents = [
      agent({ id: 'a', toolName: 'Codex CLI', status: 'active', appearAt: 0 }),
      agent({ id: 'b', toolName: 'Cursor', status: 'idle', appearAt: 0, statusChangedAt: 0, color: 'green' }),
      agent({ id: 'c', toolName: 'Claude Code', status: 'starting', appearAt: 9000, color: 'yellow' }),
    ];
    const worldFrame = animator.buildFrame({ agents, width, height, now: 10000, selectedId: 'c', showDebugRoutes: true });
    const output = stripBlessedTags(renderOffice({ worldFrame, agents, paused: false }));
    const titleLine = output.split('\n')[0];

    assert.match(output, /agent-office/);
    assert.match(output, /break/);
    assert.match(output, /▓/);
    assert.match(output, /▬/);
    assert.match(output, /cdx·t|cur·d|cla·t|demo·/);
    assert.match(output, /\bo\b/);
    assert.match(output, /sessions|q quit/);
    assert.match(output, /~/);
    assert.doesNotMatch(titleLine, /\bo\b|o[)>\\\/]|[<(]o/);
  }
});
