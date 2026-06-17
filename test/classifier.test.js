const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyProcesses } = require('../src/detection');
const { buildProcessContext } = require('../src/discovery/processContext');
const { DEFAULT_CONFIG, normalizeConfig } = require('../src/config');
const { basenameFromCommand } = require('../src/util/text');

function proc(pid, ppid, command, stat = 'S', cwd) {
  return {
    pid,
    ppid,
    stat,
    etime: '00:01',
    elapsedMs: 1000,
    startedAt: 1000,
    command,
    name: basenameFromCommand(command),
    lowerCommand: command.toLowerCase(),
    lowerName: basenameFromCommand(command).toLowerCase(),
    cwd,
  };
}

test('classifies Codex CLI from command metadata', () => {
  const processes = [
    proc(100, 1, '/bin/zsh'),
    proc(200, 100, '/opt/homebrew/bin/codex --cwd /Users/me/project'),
  ];
  const config = normalizeConfig(DEFAULT_CONFIG);
  const agents = classifyProcesses(processes, buildProcessContext(processes), config);

  assert.equal(agents.length, 1);
  assert.equal(agents[0].toolKey, 'codex-cli');
  assert.equal(agents[0].toolName, 'Codex CLI');
  assert.equal(agents[0].surface, 'terminal');
  assert.equal(agents[0].projectPath, '/Users/me/project');
});

test('groups Cursor helper processes by root app pid and derives project labels', () => {
  const processes = [
    proc(300, 1, '/Applications/Cursor.app/Contents/MacOS/Cursor /Users/me/site'),
    proc(301, 300, '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper.app/Contents/MacOS/Cursor Helper --type=renderer'),
  ];
  const config = normalizeConfig(DEFAULT_CONFIG);
  const agents = classifyProcesses(processes, buildProcessContext(processes), config);

  assert.equal(agents.length, 1);
  assert.equal(agents[0].toolKey, 'cursor');
  assert.equal(agents[0].surface, 'desktop');
  assert.equal(agents[0].projectPath, '/Users/me/site');
  assert.deepEqual(agents[0].pids, [300, 301]);
});

test('classifies Claude Code from terminal command metadata', () => {
  const processes = [
    proc(700, 1, '/bin/zsh'),
    proc(701, 700, '/opt/homebrew/bin/claude --project /Users/me/cart --session checkout-tests'),
  ];
  const config = normalizeConfig(DEFAULT_CONFIG);
  const agents = classifyProcesses(processes, buildProcessContext(processes), config);

  assert.equal(agents.length, 1);
  assert.equal(agents[0].toolKey, 'claude-code');
  assert.equal(agents[0].toolName, 'Claude Code');
  assert.equal(agents[0].surface, 'terminal');
  assert.equal(agents[0].projectPath, '/Users/me/cart');
  assert.equal(agents[0].sessionName, 'checkout-tests');
});

test('uses terminal cwd as project fallback when command has no path', () => {
  const processes = [
    proc(710, 1, '/bin/zsh'),
    proc(711, 710, '/opt/homebrew/bin/claude --dangerously-skip-permissions', 'S', '/Users/me/shop'),
  ];
  const config = normalizeConfig(DEFAULT_CONFIG);
  const agents = classifyProcesses(processes, buildProcessContext(processes), config);

  assert.equal(agents.length, 1);
  assert.equal(agents[0].toolKey, 'claude-code');
  assert.equal(agents[0].projectPath, '/Users/me/shop');
  assert.equal(agents[0].sessionName, 'shop');
});

test('groups Claude desktop helper processes into one app agent', () => {
  const processes = [
    proc(800, 1, '/Applications/Claude.app/Contents/MacOS/Claude /Users/me/research'),
    proc(801, 800, '/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=renderer'),
    proc(802, 1, '/Applications/Claude.app/Contents/Frameworks/Electron Framework.framework/Helpers/chrome_crashpad_handler --monitor-self'),
  ];
  const config = normalizeConfig(DEFAULT_CONFIG);
  const agents = classifyProcesses(processes, buildProcessContext(processes), config);

  assert.equal(agents.length, 1);
  assert.equal(agents[0].toolKey, 'claude-desktop');
  assert.equal(agents[0].toolName, 'Claude Desktop');
  assert.equal(agents[0].surface, 'desktop');
  assert.equal(agents[0].projectPath, '/Users/me/research');
  assert.deepEqual(agents[0].pids, [800, 801]);
});

test('ignores incidental cursor and claude strings in unrelated paths', () => {
  const processes = [
    proc(500, 1, '/System/Library/PrivateFrameworks/TextInputUIMacHelper.framework/Versions/A/XPCServices/CursorUIViewService.xpc/Contents/MacOS/CursorUIViewService'),
    proc(501, 1, '/bin/zsh -c source /Users/me/.claude/shell-snapshots/snapshot.sh'),
  ];
  const config = normalizeConfig(DEFAULT_CONFIG);
  const agents = classifyProcesses(processes, buildProcessContext(processes), config);

  assert.equal(agents.length, 0);
});

test('groups Codex desktop helper processes into one app agent', () => {
  const processes = [
    proc(600, 1, '/Applications/Codex.app/Contents/MacOS/Codex'),
    proc(601, 600, '/Applications/Codex.app/Contents/Frameworks/Codex Helper.app/Contents/MacOS/Codex Helper --type=renderer'),
    proc(602, 601, '/Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl'),
    proc(603, 1, '/Applications/Codex.app/Contents/Frameworks/Codex Framework.framework/Versions/149.0.7827.115/Helpers/browser_crashpad_handler --monitor-self'),
  ];
  const config = normalizeConfig(DEFAULT_CONFIG);
  const agents = classifyProcesses(processes, buildProcessContext(processes), config);

  assert.equal(agents.length, 1);
  assert.equal(agents[0].toolKey, 'codex-desktop');
  assert.equal(agents[0].surface, 'desktop');
  assert.deepEqual(agents[0].pids, [600, 601, 602]);
});

test('classifies custom tools from config command patterns', () => {
  const processes = [
    proc(400, 1, '/usr/local/bin/my-ai-tool --workspace /Users/me/custom'),
  ];
  const config = normalizeConfig({
    ...DEFAULT_CONFIG,
    customTools: [
      {
        key: 'custom-ai',
        name: 'Custom AI',
        icon: 'A',
        commandPatterns: ['my-ai-tool'],
      },
    ],
  });
  const agents = classifyProcesses(processes, buildProcessContext(processes), config);

  assert.equal(agents.length, 1);
  assert.equal(agents[0].toolName, 'Custom AI');
  assert.equal(agents[0].projectPath, '/Users/me/custom');
});
