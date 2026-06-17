const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyAppWindowTitles,
  applyTerminalTitles,
  cleanTitle,
  cleanWindowTitle,
  isGenericTitle,
  isGenericWindowTitle,
  normalizeTty,
  parseAppTitleLines,
  parseTitleLines,
} = require('../src/discovery/terminalTitles');

test('normalizes tty values from ps and AppleScript to a common key', () => {
  assert.equal(normalizeTty('/dev/ttys000'), 's000');
  assert.equal(normalizeTty('ttys001'), 's001');
  assert.equal(normalizeTty('s002'), 's002');
  assert.equal(normalizeTty('??'), '??');
  assert.equal(normalizeTty(''), undefined);
});

test('strips the braille spinner prefix from Claude/Codex titles', () => {
  assert.equal(cleanTitle('⠂ Gamehub'), 'Gamehub');
  assert.equal(cleanTitle('⠐ ai-office'), 'ai-office');
  assert.equal(cleanTitle('  • refactor auth  '), 'refactor auth');
});

test('detects generic shell titles that carry no identity', () => {
  assert.equal(isGenericTitle('-zsh'), true);
  assert.equal(isGenericTitle('bash'), true);
  assert.equal(isGenericTitle('tobiasmastek — -zsh — 80×24'), true);
  assert.equal(isGenericTitle('Gamehub'), false);
});

test('parses AppleScript tty || title output', () => {
  const out = '/dev/ttys000 || ⠂ Gamehub\n/dev/ttys003 || ⠐ ai-office\n\n';
  const entries = parseTitleLines(out, 'Terminal');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { tty: 's000', title: 'Gamehub', raw: '⠂ Gamehub', app: 'Terminal', working: true });
  assert.equal(entries[1].tty, 's003');
  assert.equal(entries[1].title, 'ai-office');
});

test('applies tab titles to terminal agents by tty', () => {
  const titles = new Map([
    ['s000', { tty: 's000', title: 'Gamehub', app: 'Terminal' }],
    ['s003', { tty: 's003', title: '-zsh', app: 'Terminal' }],
  ]);
  const agents = [
    { surface: 'terminal', tty: 's000', sessionName: 'claude@s000' },
    { surface: 'terminal', tty: 's003', sessionName: 'claude@s003' }, // generic title -> kept
    { surface: 'desktop', tty: undefined, sessionName: 'claude-app-530' },
  ];
  applyTerminalTitles(agents, titles);

  assert.equal(agents[0].sessionName, 'Gamehub');
  assert.equal(agents[0].terminalTitle, 'Gamehub');
  assert.equal(agents[0].title, 'Gamehub');
  assert.equal(agents[1].sessionName, 'claude@s003'); // generic -zsh ignored
  assert.equal(agents[2].sessionName, 'claude-app-530'); // desktop untouched
});

test('applyTerminalTitles is a no-op with an empty map', () => {
  const agents = [{ surface: 'terminal', tty: 's000', sessionName: 'claude@s000' }];
  applyTerminalTitles(agents, new Map());
  assert.equal(agents[0].sessionName, 'claude@s000');
});

test('parses app window titles and strips the app-name suffix', () => {
  const out = 'Cursor :: my-repo — Cursor\nClaude :: Claude\nCodex :: Mast3kMedia\n';
  const entries = parseAppTitleLines(out);
  const byProc = Object.fromEntries(entries.map((e) => [e.proc, e.title]));
  assert.equal(byProc.cursor, 'my-repo');
  assert.equal(byProc.codex, 'Mast3kMedia');
  assert.equal(byProc.claude, 'Claude');
});

test('cleanWindowTitle drops trailing app names', () => {
  assert.equal(cleanWindowTitle('app.tsx — Cursor'), 'app.tsx');
  assert.equal(cleanWindowTitle('Billing - Codex'), 'Billing');
});

test('isGenericWindowTitle flags bare app names', () => {
  assert.equal(isGenericWindowTitle('Claude'), true);
  assert.equal(isGenericWindowTitle('cursor'), true);
  assert.equal(isGenericWindowTitle('Mast3kMedia'), false);
});

test('applies app window titles to desktop agents by vendor', () => {
  const titles = new Map([
    ['codex', { proc: 'codex', title: 'Mast3kMedia' }],
    ['claude', { proc: 'claude', title: 'Claude' }], // generic -> skipped
  ]);
  const agents = [
    { surface: 'desktop', toolKey: 'codex-desktop', sessionName: 'codex-app-1118' },
    { surface: 'desktop', toolKey: 'claude-desktop', sessionName: 'claude-app-530' },
    { surface: 'terminal', toolKey: 'codex-cli', sessionName: 'codex@s000' },
  ];
  applyAppWindowTitles(agents, titles);

  assert.equal(agents[0].sessionName, 'Mast3kMedia');
  assert.equal(agents[0].windowTitle, 'Mast3kMedia');
  assert.equal(agents[1].sessionName, 'claude-app-530'); // generic title ignored
  assert.equal(agents[2].sessionName, 'codex@s000'); // terminal untouched
});
