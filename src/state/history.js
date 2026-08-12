const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultHistoryPath() {
  if (process.env.XDG_STATE_HOME) {
    return path.join(process.env.XDG_STATE_HOME, 'ai-office', 'history.jsonl');
  }
  return path.join(os.homedir(), '.ai-office', 'history.jsonl');
}

// Records one JSONL line per completed agent session so users can review what
// ran while they were away. Writing is best-effort and never throws into the UI.
class HistoryRecorder {
  constructor({ filePath = defaultHistoryPath(), enabled = true, logger } = {}) {
    this.filePath = filePath;
    this.enabled = enabled !== false;
    this.logger = logger;
    this.written = 0;
  }

  // Consume store lifecycle events; persist a record for each ended session.
  record(events = []) {
    if (!this.enabled || !Array.isArray(events) || events.length === 0) {
      return [];
    }
    const records = events
      .filter((event) => event && event.type === 'stopped')
      .map((event) => ({
        kind: 'session',
        endedAt: event.at,
        startedAt: Number.isFinite(event.runtimeMs) ? event.at - event.runtimeMs : undefined,
        runtimeMs: event.runtimeMs,
        agentId: event.agentId,
        toolKey: event.toolKey,
        toolName: event.toolName,
        surface: event.surface,
        sessionName: event.sessionName,
        title: event.title,
        projectPath: event.projectPath,
        projectLabel: event.projectLabel,
        pid: event.pid,
        lastStatus: event.previousStatus,
      }));

    if (records.length === 0) {
      return [];
    }

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
      this.written += records.length;
    } catch (error) {
      this.logger?.warn('history write failed', { error: error.message });
    }
    return records;
  }
}

function readHistory({ filePath = defaultHistoryPath(), limit } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const records = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (Number.isFinite(limit) && limit > 0) {
    return records.slice(-limit);
  }
  return records;
}

function summarizeHistory(records = []) {
  const sessions = records.filter((record) => record && record.kind === 'session');
  const byTool = new Map();
  const byProject = new Map();
  let totalRuntimeMs = 0;

  for (const session of sessions) {
    const runtime = Number.isFinite(session.runtimeMs) ? session.runtimeMs : 0;
    totalRuntimeMs += runtime;

    const toolKey = session.toolName || session.toolKey || 'unknown';
    const tool = byTool.get(toolKey) || { tool: toolKey, sessions: 0, runtimeMs: 0 };
    tool.sessions += 1;
    tool.runtimeMs += runtime;
    byTool.set(toolKey, tool);

    const projectKey = session.projectLabel || session.projectPath || session.sessionName || 'unknown';
    const project = byProject.get(projectKey) || { project: projectKey, sessions: 0, runtimeMs: 0 };
    project.sessions += 1;
    project.runtimeMs += runtime;
    byProject.set(projectKey, project);
  }

  const sortByRuntime = (a, b) => b.runtimeMs - a.runtimeMs;
  return {
    totalSessions: sessions.length,
    totalRuntimeMs,
    byTool: [...byTool.values()].sort(sortByRuntime),
    byProject: [...byProject.values()].sort(sortByRuntime),
    longest: sessions
      .slice()
      .sort((a, b) => (b.runtimeMs || 0) - (a.runtimeMs || 0))
      .slice(0, 10),
    recent: sessions.slice(-20).reverse(),
  };
}

module.exports = {
  HistoryRecorder,
  defaultHistoryPath,
  readHistory,
  summarizeHistory,
};
