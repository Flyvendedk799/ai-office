const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const CWD_KEYWORDS = [
  'aider',
  'amp',
  'claude',
  'claude-code',
  'codex',
  'cursor',
  'cursor-agent',
  'gemini',
  'goose',
  'opencode',
  'openhands',
  'qwen',
  'sweep',
];

async function collectProcessCwds(processes, logger) {
  const pids = processes
    .filter(shouldCollectCwd)
    .map((proc) => proc.pid)
    .filter(Boolean)
    .slice(0, 120);

  if (pids.length === 0) {
    return new Map();
  }

  try {
    const { stdout } = await execFileAsync('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids.join(',')], {
      maxBuffer: 1024 * 1024,
      timeout: 1200,
    });
    return parseLsofCwds(stdout);
  } catch (error) {
    if (error.stdout) {
      return parseLsofCwds(error.stdout);
    }
    logger?.debug('cwd scan unavailable', { error: error.message });
    return new Map();
  }
}

function shouldCollectCwd(proc) {
  const text = `${proc.lowerName || ''} ${proc.lowerCommand || ''}`;
  return CWD_KEYWORDS.some((keyword) => text.includes(keyword));
}

function parseLsofCwds(output) {
  const cwdByPid = new Map();
  let currentPid;

  for (const line of String(output || '').split('\n')) {
    if (line.startsWith('p')) {
      currentPid = Number(line.slice(1));
    } else if (line.startsWith('n') && currentPid) {
      cwdByPid.set(currentPid, line.slice(1));
    }
  }

  return cwdByPid;
}

module.exports = {
  collectProcessCwds,
  parseLsofCwds,
  shouldCollectCwd,
};
