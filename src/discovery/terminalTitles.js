const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// macOS terminals expose each tab/session's title keyed by its tty. Claude Code
// and Codex set that title to the project/session name (often with a braille
// spinner prefix while working), which is the most reliable "session" identity
// for a terminal agent. We read it via AppleScript, guarded so we never launch
// an app that is not already running.

const TERMINAL_SCRIPT = [
  'if application "Terminal" is running then',
  '  tell application "Terminal"',
  '    set out to ""',
  '    repeat with w in windows',
  '      repeat with t in tabs of w',
  '        set theTty to (tty of t)',
  '        try',
  '          set theTitle to (custom title of t)',
  '        on error',
  '          set theTitle to ""',
  '        end try',
  '        if theTitle is missing value then set theTitle to ""',
  '        set out to out & theTty & " || " & theTitle & linefeed',
  '      end repeat',
  '    end repeat',
  '    return out',
  '  end tell',
  'end if',
];

const ITERM_SCRIPT = [
  'if application "iTerm2" is running then',
  '  tell application "iTerm2"',
  '    set out to ""',
  '    repeat with w in windows',
  '      repeat with t in tabs of w',
  '        repeat with s in sessions of t',
  '          try',
  '            set out to out & (tty of s) & " || " & (name of s) & linefeed',
  '          end try',
  '        end repeat',
  '      end repeat',
  '    end repeat',
  '    return out',
  '  end tell',
  'end if',
];

// Desktop agents (Claude/Codex/Cursor apps) keep their "session" inside the app.
// The frontmost window title is the visible session identity (the open project
// or conversation). Reading it needs Accessibility permission for the app that
// launches agent-office, so this is opt-in.
const APP_WINDOW_SCRIPT = [
  'set out to ""',
  'repeat with procName in {"Claude", "Codex", "Cursor"}',
  '  try',
  '    tell application "System Events"',
  '      if exists process (procName as string) then',
  '        tell process (procName as string)',
  '          if (count of windows) > 0 then',
  '            set out to out & (procName as string) & " :: " & (name of window 1) & linefeed',
  '          end if',
  '        end tell',
  '      end if',
  '    end tell',
  '  end try',
  'end repeat',
  'return out',
];

function toArgs(lines) {
  const args = [];
  for (const line of lines) {
    args.push('-e', line);
  }
  return args;
}

async function runOsascript(lines, app, logger) {
  try {
    const { stdout } = await execFileAsync('osascript', toArgs(lines), { timeout: 1500, maxBuffer: 1024 * 1024 });
    return parseTitleLines(stdout, app);
  } catch (error) {
    logger?.debug('terminal title scan unavailable', { app, error: error.message });
    return [];
  }
}

async function collectTerminalTitles({ enabled = true, logger, platform = process.platform } = {}) {
  const map = new Map();
  if (!enabled || platform !== 'darwin') {
    return map;
  }
  const results = await Promise.allSettled([
    runOsascript(TERMINAL_SCRIPT, 'Terminal', logger),
    runOsascript(ITERM_SCRIPT, 'iTerm2', logger),
  ]);
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      continue;
    }
    for (const entry of result.value) {
      if (entry.tty && !map.has(entry.tty)) {
        map.set(entry.tty, entry);
      }
    }
  }
  return map;
}

async function collectAppWindowTitles({ enabled = false, logger, platform = process.platform } = {}) {
  const map = new Map();
  if (!enabled || platform !== 'darwin') {
    return map;
  }
  try {
    const { stdout } = await execFileAsync('osascript', toArgs(APP_WINDOW_SCRIPT), { timeout: 1500, maxBuffer: 1024 * 1024 });
    for (const entry of parseAppTitleLines(stdout)) {
      if (!map.has(entry.proc)) {
        map.set(entry.proc, entry);
      }
    }
  } catch (error) {
    const denied = /assistive access|not allowed/i.test(error.message || '');
    logger?.debug('app window title scan unavailable', {
      error: error.message,
      hint: denied ? 'Grant Accessibility access to the terminal app running agent-office.' : undefined,
    });
  }
  return map;
}

function parseAppTitleLines(output) {
  const entries = [];
  for (const rawLine of String(output || '').split('\n')) {
    const line = rawLine.trim();
    const separator = line.indexOf(' :: ');
    if (separator < 0) {
      continue;
    }
    const proc = line.slice(0, separator).trim().toLowerCase();
    const raw = line.slice(separator + 4);
    const title = cleanWindowTitle(raw, proc);
    if (proc) {
      entries.push({ proc, title, raw });
    }
  }
  return entries;
}

function cleanWindowTitle(raw, proc) {
  let text = cleanTitle(raw);
  // Drop a trailing " — AppName" / " - AppName" suffix (e.g. "repo — Cursor").
  text = text.replace(/\s*[—\-|]\s*(Claude|Codex|Cursor)\s*$/i, '').trim();
  return text;
}

// A window title that is just the app's own name carries no session identity.
function isGenericWindowTitle(title) {
  const text = String(title || '').trim().toLowerCase();
  return !text || /^(claude|codex|cursor)$/.test(text);
}

function appKeyForAgent(agent) {
  const key = String(`${agent.toolKey || ''} ${agent.toolName || ''} ${agent.processName || ''}`).toLowerCase();
  if (key.includes('codex')) return 'codex';
  if (key.includes('claude')) return 'claude';
  if (key.includes('cursor')) return 'cursor';
  return undefined;
}

function applyAppWindowTitles(agents, titles) {
  if (!titles || titles.size === 0) {
    return agents;
  }
  for (const agent of agents) {
    if (agent.surface !== 'desktop') {
      continue;
    }
    const entry = titles.get(appKeyForAgent(agent));
    if (!entry || !entry.title || isGenericWindowTitle(entry.title)) {
      continue;
    }
    agent.windowTitle = entry.title;
    agent.sessionName = entry.title;
    if (!agent.title) {
      agent.title = entry.title;
    }
  }
  return agents;
}

function parseTitleLines(output, app) {
  const entries = [];
  for (const rawLine of String(output || '').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || !line.includes(' || ')) {
      continue;
    }
    const separator = line.indexOf(' || ');
    const tty = normalizeTty(line.slice(0, separator));
    const raw = line.slice(separator + 4);
    const title = cleanTitle(raw);
    if (tty) {
      entries.push({ tty, title, raw, app, working: hasSpinner(raw) });
    }
  }
  return entries;
}

// ps reports "s000"; AppleScript reports "/dev/ttys000". Normalize both to "s000".
function normalizeTty(value) {
  const text = String(value || '').trim();
  if (!text) {
    return undefined;
  }
  return text.replace(/^\/dev\//, '').replace(/^tty/, '') || undefined;
}

// Claude Code / Codex prefix the title with an animated braille spinner. Strip
// leading spinner/symbol noise but keep the meaningful name.
function hasSpinner(raw) {
  return /[⠀-⣿⚀-⛿•·]/.test(String(raw || ''));
}

function cleanTitle(raw) {
  return String(raw || '')
    .replace(/[⠀-⣿]/g, '') // braille spinner frames
    .replace(/^[\s•·•·*\-—|]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Generic shell titles carry no session identity and should not override a
// real label.
function isGenericTitle(title) {
  const text = String(title || '').trim().toLowerCase();
  if (!text) {
    return true;
  }
  return /^(-?(z|ba|fi)?sh|login|tmux|screen|terminal|agent office)$/.test(text)
    || /\b\d+×\d+\b/.test(text);
}

function applyTerminalTitles(agents, titles) {
  if (!titles || titles.size === 0) {
    return agents;
  }
  for (const agent of agents) {
    if (agent.surface !== 'terminal' || !agent.tty) {
      continue;
    }
    const entry = titles.get(agent.tty);
    if (!entry || !entry.title || isGenericTitle(entry.title)) {
      continue;
    }
    agent.terminalTitle = entry.title;
    agent.terminalApp = entry.app;
    // The tab title is the stable session identity the user recognizes.
    agent.sessionName = entry.title;
    if (!agent.title) {
      agent.title = entry.title;
    }
  }
  return agents;
}

module.exports = {
  applyAppWindowTitles,
  applyTerminalTitles,
  cleanTitle,
  cleanWindowTitle,
  collectAppWindowTitles,
  collectTerminalTitles,
  isGenericTitle,
  isGenericWindowTitle,
  normalizeTty,
  parseAppTitleLines,
  parseTitleLines,
};
