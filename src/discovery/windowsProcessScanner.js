const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { basenameFromCommand } = require('../util/text');

const execFileAsync = promisify(execFile);

// One CIM query returns identity, memory, start time, and cumulative CPU time
// for every process. CPU% is derived in Node from the delta between scans
// (first scan falls back to the lifetime average, like `ps` on Linux).
const PS_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$list = Get-CimInstance Win32_Process | ForEach-Object {
  [pscustomobject]@{
    pid = [int]$_.ProcessId
    ppid = [int]$_.ParentProcessId
    name = [string]$_.Name
    command = [string]$_.CommandLine
    rssKb = [long]($_.WorkingSetSize / 1024)
    startMs = if ($_.CreationDate) { [long]([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }
    cpuMs = [long](($_.KernelModeTime + $_.UserModeTime) / 10000)
  }
}
ConvertTo-Json -InputObject @($list) -Compress -Depth 3
`;

const ENCODED_SCRIPT = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');

// pid -> { cpuMs, at } from the previous scan, so CPU% reflects the interval
// between scans rather than the process lifetime.
const cpuSamples = new Map();

async function scanProcessesWindows({ logger } = {}) {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', ENCODED_SCRIPT,
    ], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15000,
      windowsHide: true,
    });
    const processes = parseWindowsProcesses(stdout, Date.now());
    logger?.debug('process scan complete', { count: processes.length, platform: 'win32' });
    return processes;
  } catch (error) {
    logger?.warn('process scan failed', { error: error.message, platform: 'win32' });
    return [];
  }
}

function parseWindowsProcesses(json, now = Date.now(), samples = cpuSamples, totalMemKb = os.totalmem() / 1024) {
  let rows;
  try {
    rows = JSON.parse(String(json || '[]'));
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) {
    rows = rows ? [rows] : [];
  }

  const seen = new Set();
  const processes = [];
  for (const row of rows) {
    const proc = toProcess(row, now, samples, totalMemKb);
    if (proc) {
      seen.add(proc.pid);
      processes.push(proc);
    }
  }

  for (const pid of samples.keys()) {
    if (!seen.has(pid)) {
      samples.delete(pid);
    }
  }

  return processes;
}

function toProcess(row, now, samples, totalMemKb) {
  const pid = Number(row?.pid);
  if (!Number.isFinite(pid) || pid <= 0) {
    return null;
  }
  const command = String(row.command || '').trim() || String(row.name || '').trim();
  if (!command) {
    return null;
  }

  const startMs = Number(row.startMs) || 0;
  const elapsedMs = startMs > 0 ? Math.max(0, now - startMs) : 0;
  const rssKb = Number.isFinite(Number(row.rssKb)) ? Number(row.rssKb) : undefined;
  const cpu = cpuPercent(pid, Number(row.cpuMs), elapsedMs, now, samples);
  const name = basenameFromCommand(command) || String(row.name || '').replace(/\.exe$/i, '');

  return {
    pid,
    ppid: Number(row.ppid) || 0,
    stat: undefined,
    etime: undefined,
    elapsedMs,
    startedAt: startMs > 0 ? startMs : now - elapsedMs,
    cpu,
    mem: Number.isFinite(rssKb) && totalMemKb > 0
      ? Math.round((rssKb / totalMemKb) * 1000) / 10
      : undefined,
    rssKb,
    tty: undefined,
    command,
    name,
    lowerCommand: command.toLowerCase(),
    lowerName: name.toLowerCase(),
  };
}

function cpuPercent(pid, cpuMs, elapsedMs, now, samples) {
  if (!Number.isFinite(cpuMs)) {
    return undefined;
  }
  const previous = samples.get(pid);
  samples.set(pid, { cpuMs, at: now });
  // A cpuMs drop means the pid was reused by a new process; fall through to
  // the lifetime average in that case.
  if (previous && cpuMs >= previous.cpuMs && now > previous.at) {
    return Math.round(((cpuMs - previous.cpuMs) / (now - previous.at)) * 1000) / 10;
  }
  if (elapsedMs > 0) {
    return Math.round((cpuMs / elapsedMs) * 1000) / 10;
  }
  return 0;
}

module.exports = {
  parseWindowsProcesses,
  scanProcessesWindows,
};
