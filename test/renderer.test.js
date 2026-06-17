const test = require('node:test');
const assert = require('node:assert/strict');
const { renderOffice } = require('../src/tui/renderers');

function stripBlessedTags(value) {
  return String(value).replace(/\{[^}]*\}/g, '');
}

test('renders a compact top-down agent working at a desk', () => {
  const output = stripBlessedTags(renderOffice({
    agents: [
      {
        id: 'agent-a',
        toolKey: 'codex-cli',
        toolName: 'Codex CLI',
        sessionName: 'demo',
        pid: 123,
        color: 'cyan',
        status: 'active',
        appearAt: 0,
      },
    ],
    width: 80,
    height: 30,
    now: 10000,
    frame: 2,
    selectedId: 'agent-a',
    paused: false,
  }));

  assert.match(output, /agent-office/);
  assert.match(output, /break/);
  assert.match(output, /▓/);
  assert.match(output, /▬/);
  assert.match(output, /\bo\b/);
  assert.match(output, /demo·typ|\[cdx·t\]/);
  assert.match(output, /sessions/);
  assert.match(output, /q quit/);
});

test('renders idle agents drinking coffee in the break room', () => {
  const output = stripBlessedTags(renderOffice({
    agents: [
      {
        id: 'agent-b',
        toolKey: 'cursor',
        toolName: 'Cursor',
        sessionName: 'demo',
        pid: 456,
        color: 'green',
        status: 'idle',
        appearAt: 0,
        previousStatus: 'active',
        statusChangedAt: 0,
      },
    ],
    width: 80,
    height: 30,
    now: 10000,
    frame: 1,
    selectedId: 'agent-b',
    paused: false,
  }));

  assert.match(output, /break/);
  assert.match(output, /▣/);
  assert.match(output, /~/);
  assert.match(output, /\bo\b/);
  assert.match(output, /\[cur·d\]/);
  assert.match(output, /break/);
});

test('renders new agents running through the office on a path', () => {
  const output = stripBlessedTags(renderOffice({
    agents: [
      {
        id: 'agent-c',
        toolName: 'Claude Code',
        sessionName: 'tests',
        pid: 789,
        color: 'yellow',
        status: 'starting',
        appearAt: 9400,
      },
    ],
    width: 90,
    height: 22,
    now: 10000,
    frame: 1,
    selectedId: 'agent-c',
    paused: false,
  }));

  assert.match(output, /agent-office/);
  assert.match(output, /▓/);
  assert.match(output, /\/|\\/);
  assert.match(output, /\[cla·t\]|tests/);
  assert.match(output, /walking|q quit/);
  assert.doesNotMatch(output, /o\/|\\o/);
  assert.match(output, /~/);
});
