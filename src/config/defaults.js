const os = require('os');
const path = require('path');

const DEFAULT_CONFIG = {
  scanIntervalMs: 2000,
  stoppedGraceMs: 10000,
  enableWindowTitleScan: true,
  enableAppWindowTitleScan: false,
  enableSessionMetadataScan: true,
  // v2: persistent session history + alerts + default view.
  enableHistory: true,
  historyPath: undefined,
  bellOnFinish: true,
  idleAlertMs: 0,
  defaultView: 'office',
  sessionFolderPaths: [],
  // Match our own entry points precisely — a bare "ai-office" substring would
  // also hide real agents working inside a folder that happens to bear the name.
  excludePatterns: [
    'bin/ai-office.js',
    'bin\\ai-office.js',
    'ai-office.cmd',
    'agent-office',
    // Auto-updaters and crash handlers bundled with the desktop apps are not
    // agents, but their command lines mention the app/bundle id, so exclude them.
    'Sparkle.framework',
    'org.sparkle-project',
    'Autoupdate',
    'Updater.app',
    'crashpad',
    'ggml-metal',
  ],
  terminalAgentKeywords: [
    'aider',
    'amp',
    'claude',
    'claude-code',
    'codex',
    'continue',
    'cursor-agent',
    'gemini',
    'goose',
    'opencode',
    'openhands',
    'qwen',
    'sweep',
  ],
  customTools: [],
};

function defaultConfigPath() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'ai-office', 'config.json');
  }
  return path.join(os.homedir(), '.ai-office', 'config.json');
}

module.exports = {
  DEFAULT_CONFIG,
  defaultConfigPath,
};
