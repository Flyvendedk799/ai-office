const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const blessed = require('blessed');
const { startTui, cdCommand } = require('../src/tui/app');
const { DEFAULT_CONFIG } = require('../src/config');

test('real TUI routes prompt input, views, pause and shutdown without leaking keys', async (t) => {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = output.isTTY = true;
  input.setRawMode = () => {};
  output.columns = 100; output.rows = 34;
  output.on('data', () => {});
  let screen;
  const factory = blessed.screen;
  blessed.screen = (options) => { screen = factory({ ...options, input, output, terminal: 'xterm-256color' }); return screen; };
  const running = startTui({ config: { ...DEFAULT_CONFIG, enableHistory: false }, options: { demo: true }, logger: { warn() {} }, discovery: { discover: async () => [{ id: 'a', title: 'Auth refactor', pid: 123, startedAt: 0, appearAt: 0, statusHint: 'active', toolName: 'Codex', currentTask: 'write tests' }] } });
  blessed.screen = factory;
  t.after(() => { if (!screen.destroyed) screen.destroy(); input.destroy(); output.destroy(); });
  await new Promise(setImmediate);
  const key = (name, ch = name) => screen.emit('keypress', ch, { name });
  const content = () => screen.children[0].content.replace(/\{[^}]*\}/g, '');
  key('d'); assert.match(content(), /dashboard/);
  key('/'); key('q');
  assert.equal(screen.destroyed, undefined); // q is filter text, not a quit shortcut
  assert.match(content(), /No agents match/);
  key('escape'); assert.match(content(), /Auth refactor/);
  key('k'); key('t');
  assert.match(screen.children[2].content, /Demo: would send SIGTERM/);
  key('e'); assert.match(content(), /activity/);
  key('o'); key('p'); assert.match(screen.children[1].content, /animation paused/);
  key('m'); assert.match(screen.children[1].content, /reduced motion/);
  key('h'); assert.match(screen.children[2].content, /Help/);
  key('escape'); key('q');
  await running;
  assert.equal(screen.destroyed, true);
});

test('project hints quote paths for the current shell', () => {
  assert.equal(cdCommand("C:\\work\\Tobias's project", 'win32'), "Set-Location -LiteralPath 'C:\\work\\Tobias''s project'");
  assert.equal(cdCommand("/work/Tobias's project", 'linux'), "cd -- '/work/Tobias'\\''s project'");
});
