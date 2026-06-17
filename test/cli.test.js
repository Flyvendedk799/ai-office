const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', 'bin', 'agent-office.js');

test('CLI help documents v2 run modes and controls', async () => {
  const { stdout } = await execFileAsync(process.execPath, [CLI, '--help']);

  assert.match(stdout, /--once/);
  assert.match(stdout, /--json/);
  assert.match(stdout, /--dashboard/);
  assert.match(stdout, /--watch/);
  assert.match(stdout, /--history/);
  assert.match(stdout, /Signal agent/);
});

test('CLI demo once mode prints machine-readable agent snapshot with metrics', async () => {
  const { stdout } = await execFileAsync(process.execPath, [CLI, '--demo', '--once', '--json'], {
    maxBuffer: 1024 * 1024,
  });
  const agents = JSON.parse(stdout);

  assert.ok(Array.isArray(agents));
  assert.ok(agents.length > 0);
  assert.ok(agents.some((agent) => agent.toolKey === 'codex-desktop' && agent.currentTask));
  assert.ok(agents.some((agent) => agent.toolKey === 'claude-code' && agent.toolCall));
  assert.ok(agents.every((agent) => typeof agent.cpu === 'number'));
  assert.ok(agents.some((agent) => typeof agent.rssKb === 'number'));
});

test('CLI history mode reports an empty store gracefully', async () => {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-state-'));
  const { stdout } = await execFileAsync(process.execPath, [CLI, '--history'], {
    env: { ...process.env, XDG_STATE_HOME: stateHome },
  });
  assert.match(stdout, /No recorded sessions yet/);
});

test('CLI rejects an invalid scan interval', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [CLI, '--scan-interval', '10']),
    (error) => {
      assert.match(String(error.stderr), /--scan-interval must be a number/);
      return true;
    },
  );
});
