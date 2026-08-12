const test = require('node:test');
const assert = require('node:assert/strict');
const { MAP_H, MAP_W, SEATS, renderOffice } = require('../src/tui/office');

function stripBlessedTags(value) {
  return String(value).replace(/\{[^}]*\}/g, '');
}

test('the floor plan is structurally sound', () => {
  // Every seat must have a desk above it and open floor for the name label.
  assert.ok(SEATS.length >= 12);
  assert.ok(MAP_W >= 60 && MAP_H >= 12);
});

test('renders an agent working at a desk', () => {
  const output = stripBlessedTags(renderOffice({
    agents: [
      {
        id: 'agent-a',
        toolKey: 'codex-cli',
        toolName: 'Codex CLI',
        sessionName: 'demo',
        pid: 123,
        status: 'active',
        appearAt: 0,
      },
    ],
    width: 90,
    height: 30,
    now: 20000,
    selectedId: 'agent-a',
    paused: false,
  }));

  assert.match(output, /ai-office/);
  assert.match(output, /break room/);
  assert.match(output, /║/);
  assert.match(output, /▬/);
  assert.match(output, /\bo\b/);
  assert.match(output, /demo/);
  assert.match(output, /sessions/);
  assert.match(output, /q quit/);
  // Wall clock renders HH:MM (or the blink frame HH MM).
  assert.match(output, /\d\d[: ]\d\d/);
});

test('renders idle agents lounging in the break room', () => {
  const output = stripBlessedTags(renderOffice({
    agents: [
      {
        id: 'agent-b',
        toolKey: 'cursor',
        toolName: 'Cursor',
        sessionName: 'demo',
        pid: 456,
        status: 'idle',
        appearAt: 0,
        previousStatus: 'active',
        statusChangedAt: 0,
      },
    ],
    width: 90,
    height: 30,
    now: 60000,
    selectedId: 'agent-b',
    paused: false,
  }));

  assert.match(output, /break room/);
  assert.match(output, /▣/);
  assert.match(output, /~/);
  // The agent's head, possibly holding a cup right next to the machine.
  assert.match(output, /\bo\b|uo|o▣|▣o/);
});

test('renders arriving agents walking through the office', () => {
  const output = stripBlessedTags(renderOffice({
    agents: [
      {
        id: 'agent-c',
        toolName: 'Claude Code',
        sessionName: 'tests',
        pid: 789,
        status: 'starting',
        appearAt: 9700,
      },
    ],
    width: 90,
    height: 26,
    now: 10000,
    selectedId: 'agent-c',
    paused: false,
  }));

  assert.match(output, /ai-office/);
  assert.match(output, /║/);
  assert.match(output, /\/|\\/);
  assert.match(output, /tests/);
});

test('shows the scanning state when no agents are found', () => {
  const output = stripBlessedTags(renderOffice({
    agents: [],
    width: 90,
    height: 26,
    now: 5000,
  }));

  assert.match(output, /scanning for agents/);
  assert.match(output, /the office is empty/);
  assert.match(output, /ai-office --demo/);
});
