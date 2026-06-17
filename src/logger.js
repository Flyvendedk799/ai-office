const fs = require('fs');
const os = require('os');
const path = require('path');

function createLogger({ debug = false, logPath } = {}) {
  const lines = [];
  const resolvedLogPath = logPath || path.join(os.homedir(), '.agent-office', 'agent-office.log');

  function append(level, message, data) {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${data === undefined ? '' : ` ${safeJson(data)}`}`;
    lines.push(line);
    while (lines.length > 80) {
      lines.shift();
    }

    if (!debug) {
      return;
    }

    try {
      fs.mkdirSync(path.dirname(resolvedLogPath), { recursive: true });
      fs.appendFileSync(resolvedLogPath, `${line}\n`);
    } catch {
      // Logging must never break the TUI.
    }
  }

  return {
    debug: (message, data) => append('debug', message, data),
    info: (message, data) => append('info', message, data),
    warn: (message, data) => append('warn', message, data),
    error: (message, data) => append('error', message, data),
    isDebug: () => debug,
    logPath: resolvedLogPath,
    lastLines: (count = 8) => lines.slice(-count),
  };
}

function safeJson(data) {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

module.exports = {
  createLogger,
};

