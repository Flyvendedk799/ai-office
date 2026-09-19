const os = require('os');
const path = require('path');
const { compactHome, matchesPattern, splitCommand, stableHash } = require('../util/text');

function statusFromProcess(proc) {
  const stat = String(proc.stat || '').toUpperCase();
  // Stopped (T) or zombie (Z) processes are not actively working.
  if (stat.startsWith('T') || stat.startsWith('Z')) {
    return 'unknown';
  }
  // Both running (R) and interruptible-sleep (S) mean the agent is present and
  // alive. Interactive CLI agents spend almost all their time in S waiting on
  // I/O, so treating S as "idle" would wrongly send every agent to the break
  // room. True idleness is inferred later from stale session activity.
  return 'active';
}

function deriveProjectPath(proc) {
  const args = splitCommand(proc.command);
  const flags = new Set(['--cwd', '--project', '--project-path', '--path', '--workspace', '--folder', '-C']);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (flags.has(arg) && args[index + 1]) {
      return cleanProjectPath(args[index + 1]);
    }

    const inline = arg.match(/^--(?:cwd|project|project-path|path|workspace|folder)=(.+)$/);
    if (inline) {
      return cleanProjectPath(inline[1]);
    }
  }

  const likelyPaths = args
    .filter((arg) => /^(~|\/|[A-Za-z]:\\)/.test(arg))
    .filter((arg) => !/\/(Applications|System|Library|usr|bin|sbin)\//.test(arg))
    .filter((arg) => !/\.(js|mjs|cjs|ts|json|log|lock|exe|cmd|bat|ps1|sh)$/i.test(arg))
    .filter((arg) => !/^\/prefetch:\d+$/i.test(arg));

  if (likelyPaths.length > 0) {
    return cleanProjectPath(likelyPaths[likelyPaths.length - 1]);
  }

  if (isUsefulCwd(proc.cwd)) {
    return cleanProjectPath(proc.cwd);
  }

  return undefined;
}

function isUsefulCwd(value) {
  const cwd = cleanProjectPath(value);
  if (!cwd || cwd === '/' || cwd === os.homedir()) {
    return false;
  }
  return !/\/(Applications|System|Library|usr|bin|sbin)(\/|$)/.test(cwd);
}

function cleanProjectPath(value) {
  if (!value) {
    return undefined;
  }
  return String(value).replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
}

function deriveSessionName(proc, projectPath, fallbackPrefix, context) {
  const args = splitCommand(proc.command);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (['--session', '--session-id', '--title', '--name'].includes(arg) && args[index + 1]) {
      return { name: args[index + 1], isReal: true };
    }
    const inline = arg.match(/^--(?:session|session-id|title|name)=(.+)$/);
    if (inline) {
      return { name: inline[1], isReal: true };
    }
  }

  // Windows terminal title fallback
  if (context) {
    const { isGenericTitle, cleanTitle, isGenericWindowTitle, cleanWindowTitle } = require('../discovery/terminalTitles');
    
    // 1. If this process itself has a window title (e.g. Claude Desktop app)
    if (proc.windowTitle && !isGenericWindowTitle(proc.windowTitle)) {
      return { name: cleanWindowTitle(proc.windowTitle, proc.lowerName), isReal: true };
    }
    
    // 2. If this process is running inside a terminal host (e.g. Claude Code in powershell)
    const chain = context.parentChain(proc, 12);
    for (const parent of chain) {
      if (context.isTerminalHost(parent) && parent.windowTitle) {
        if (!isGenericTitle(parent.windowTitle)) {
          return { name: cleanTitle(parent.windowTitle), isReal: true };
        }
      }
    }
  }

  if (projectPath) {
    return { name: path.basename(projectPath), isReal: true };
  }

  const prefix = fallbackPrefix || proc.name || 'pid';
  // A terminal tab (tty) is the most recognizable handle when there is no
  // project — it lets the user match an agent to the tab they launched it in.
  if (proc.tty) {
    return { name: `${prefix}@${proc.tty}`, isReal: true };
  }
  return { name: `${prefix}-${proc.pid}`, isReal: false };
}

function makeCandidate(proc, fields, context) {
  const hasProjectPath = Object.prototype.hasOwnProperty.call(fields, 'projectPath');
  const projectPath = hasProjectPath ? fields.projectPath : deriveProjectPath(proc);
  
  let sessionName = fields.sessionName;
  let hasRealSessionName = false;
  if (sessionName) {
    hasRealSessionName = true;
  } else {
    const derived = deriveSessionName(proc, projectPath, fields.fallbackPrefix, context);
    sessionName = derived.name;
    hasRealSessionName = derived.isReal;
  }
  
  const idSeed = fields.idSeed || `${fields.toolKey}:${projectPath || sessionName || proc.pid}`;

  return {
    id: fields.id || `${fields.toolKey}:${stableHash(idSeed)}`,
    toolKey: fields.toolKey,
    toolName: fields.toolName,
    icon: fields.icon || '?',
    color: fields.color || 'magenta',
    sessionName,
    hasRealSessionName,
    projectPath,
    projectLabel: projectPath ? compactHome(projectPath) : '',
    surface: fields.surface || 'terminal',
    pid: proc.pid,
    pids: [proc.pid],
    parentPid: proc.ppid,
    command: proc.command,
    processName: proc.name,
    statusHint: fields.statusHint || statusFromProcess(proc),
    startedAt: proc.startedAt,
    runtimeMs: proc.elapsedMs,
    tty: proc.tty,
    cpu: proc.cpu,
    mem: proc.mem,
    rssKb: proc.rssKb,
    metricsByPid: {
      [proc.pid]: {
        cpu: Number.isFinite(proc.cpu) ? proc.cpu : 0,
        mem: Number.isFinite(proc.mem) ? proc.mem : 0,
        rssKb: Number.isFinite(proc.rssKb) ? proc.rssKb : 0,
      },
    },
    confidence: fields.confidence || 0.5,
    source: fields.source || fields.toolKey,
    detail: fields.detail || '',
    title: fields.title,
    currentTask: fields.currentTask,
    activity: fields.activity,
    toolCall: fields.toolCall,
    modelName: fields.modelName,
    lastActivityAt: fields.lastActivityAt,
    metadataSource: fields.metadataSource,
  };
}

function processMatchesCustomTool(proc, tool) {
  const processNameMatch = (tool.processNames || []).some((name) => proc.lowerName === name.toLowerCase());
  const commandMatch = (tool.commandPatterns || []).some((pattern) => matchesPattern(proc.command, pattern));
  return processNameMatch || commandMatch;
}

function commandInvokes(proc, commandName) {
  const wanted = String(commandName || '').toLowerCase();
  const args = splitCommand(proc.command);
  const basenames = args.slice(0, 4).map((arg) => path.basename(arg).replace(/\.exe$/i, '').toLowerCase());
  if (basenames[0] === wanted) {
    return true;
  }

  const launchers = new Set(['node', 'npx', 'npm', 'pnpm', 'yarn', 'bun', 'uvx']);
  if (launchers.has(basenames[0]) && basenames.slice(1).includes(wanted)) {
    return true;
  }

  return false;
}

module.exports = {
  commandInvokes,
  deriveProjectPath,
  deriveSessionName,
  makeCandidate,
  processMatchesCustomTool,
  statusFromProcess,
};
