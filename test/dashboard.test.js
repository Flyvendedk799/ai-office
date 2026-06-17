const test = require('node:test');
const assert = require('node:assert/strict');
const { renderDashboard, sortAgents, filterAgents } = require('../src/tui/dashboard');

function stripTags(value) {
  return String(value).replace(/\{[^}]*\}/g, '');
}

function agent(overrides) {
  return {
    id: 'codex:1',
    toolKey: 'codex-cli',
    toolName: 'Codex CLI',
    color: 'cyan',
    surface: 'terminal',
    sessionName: 'refactor-auth',
    title: 'Auth refactor',
    currentTask: 'untangle middleware',
    projectLabel: '~/work/api',
    status: 'active',
    pid: 4201,
    startedAt: 0,
    cpu: 12.5,
    rssKb: 204800,
    cpuHistory: [5, 8, 12],
    ...overrides,
  };
}

const now = 90_000;

test('renders a table with headers, metrics and summary', () => {
  const out = stripTags(renderDashboard({
    agents: [agent()],
    width: 120,
    height: 30,
    now,
    selectedId: 'codex:1',
    sortKey: 'cpu',
  }));

  assert.match(out, /AGENT OFFICE/);
  assert.match(out, /dashboard/);
  assert.match(out, /STATUS/);
  assert.match(out, /CPU/);
  assert.match(out, /MEM/);
  assert.match(out, /Codex/);
  assert.match(out, /13%/); // 12.5 rounds to 13% in the narrow column
  assert.match(out, /200M/);
  assert.match(out, /00:01:30/); // runtime 90s
  assert.match(out, /1 agents/);
  assert.match(out, /q quit/);
});

test('shows an empty-state message and filter notice', () => {
  const out = stripTags(renderDashboard({
    agents: [],
    width: 100,
    height: 24,
    now,
    filter: 'nope',
  }));
  assert.match(out, /No agents match "nope"/);
});

test('sorts agents by cpu, memory and runtime', () => {
  const a = agent({ id: 'a', cpu: 5, rssKb: 100, startedAt: 80_000 });
  const b = agent({ id: 'b', cpu: 50, rssKb: 50, startedAt: 0 });
  const c = agent({ id: 'c', cpu: 1, rssKb: 9000, startedAt: 89_000 });

  assert.deepEqual(sortAgents([a, b, c], 'cpu', now).map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(sortAgents([a, b, c], 'mem', now).map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(sortAgents([a, b, c], 'runtime', now).map((x) => x.id), ['b', 'a', 'c']);
});

test('filters agents by free text across fields', () => {
  const a = agent({ id: 'a', projectLabel: '~/work/api' });
  const b = agent({ id: 'b', projectLabel: '~/work/web', currentTask: 'tailwind migration' });

  assert.deepEqual(filterAgents([a, b], 'tailwind').map((x) => x.id), ['b']);
  assert.deepEqual(filterAgents([a, b], 'work').map((x) => x.id), ['a', 'b']);
  assert.deepEqual(filterAgents([a, b], '').map((x) => x.id), ['a', 'b']);
});

test('degrades gracefully to a narrow terminal', () => {
  const out = stripTags(renderDashboard({
    agents: [agent()],
    width: 44,
    height: 20,
    now,
    selectedId: 'codex:1',
  }));
  // Core columns survive even when optional ones are dropped.
  assert.match(out, /STATUS/);
  assert.match(out, /Codex/);
  // The row content is present.
  assert.match(out, /refactor|Auth/);
});
