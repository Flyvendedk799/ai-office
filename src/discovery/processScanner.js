const { execFile } = require('child_process');
const { promisify } = require('util');
const { basenameFromCommand } = require('../util/text');
const { parseEtime } = require('../util/time');
const { collectProcessCwds } = require('./processCwd');
const { scanProcessesWindows } = require('./windowsProcessScanner');

const execFileAsync = promisify(execFile);

async function scanProcesses({ logger, platform = process.platform } = {}) {
  if (platform === 'win32') {
    return scanProcessesWindows({ logger });
  }
  return scanProcessesPosix({ logger });
}

async function scanProcessesPosix({ logger } = {}) {
  const started = Date.now();
  try {
    const { stdout } = await execFileAsync('ps', ['-ww', '-axo', 'pid=,ppid=,stat=,etime=,%cpu=,%mem=,rss=,tt=,command='], {
      maxBuffer: 12 * 1024 * 1024,
    });
    const processes = stdout
      .split('\n')
      .map((line) => parseProcessLine(line, started))
      .filter(Boolean);
    const cwdByPid = await collectProcessCwds(processes, logger);
    for (const proc of processes) {
      if (cwdByPid.has(proc.pid)) {
        proc.cwd = cwdByPid.get(proc.pid);
      }
    }

    logger?.debug('process scan complete', { count: processes.length });
    return processes;
  } catch (error) {
    logger?.warn('process scan failed', { error: error.message });
    return [];
  }
}

function parseProcessLine(line, now = Date.now()) {
  // v2 layout with tty: pid ppid stat etime %cpu %mem rss tt command
  let match = String(line || '').match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
  let cpu;
  let mem;
  let rssKb;
  let tty;
  let command;
  if (match) {
    cpu = Number(match[5]);
    mem = Number(match[6]);
    rssKb = Number(match[7]);
    tty = match[8];
    command = (match[9] || '').trim();
  } else {
    // Legacy layout (no metrics columns): pid ppid stat etime command
    match = String(line || '').match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (!match) {
      return null;
    }
    command = (match[5] || '').trim();
  }

  const pid = Number(match[1]);
  const ppid = Number(match[2]);
  const stat = match[3];
  const etime = match[4];
  if (!pid || !command) {
    return null;
  }

  const elapsedMs = parseEtime(etime);
  const name = basenameFromCommand(command);

  return {
    pid,
    ppid,
    stat,
    etime,
    elapsedMs,
    startedAt: now - elapsedMs,
    cpu: Number.isFinite(cpu) ? cpu : undefined,
    mem: Number.isFinite(mem) ? mem : undefined,
    rssKb: Number.isFinite(rssKb) ? rssKb : undefined,
    tty: tty && tty !== '??' && tty !== '?' ? tty : undefined,
    command,
    name,
    lowerCommand: command.toLowerCase(),
    lowerName: name.toLowerCase(),
  };
}

module.exports = {
  parseProcessLine,
  scanProcesses,
};
