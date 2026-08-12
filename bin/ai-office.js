#!/usr/bin/env node

const { loadConfig, defaultConfigPath } = require('../src/config');
const { createLogger } = require('../src/logger');
const { RealDiscovery } = require('../src/discovery');
const { DemoDiscovery } = require('../src/demo');
const { AgentStore } = require('../src/state/store');
const {
  HistoryRecorder,
  defaultHistoryPath,
  readHistory,
  summarizeHistory,
} = require('../src/state/history');
const { formatDuration } = require('../src/util/time');
const { formatMemoryKb, formatPercent } = require('../src/util/format');
const { startTui } = require('../src/tui/app');

function printHelp() {
  console.log(`ai-office — your local AI coding agents, visible: a tiny animated
ASCII office plus a live metrics dashboard.

Usage:
  ai-office [options]

Run modes:
  (default)               Animated office TUI.
  --dashboard             Start in the dense dashboard (table) view.
  --watch                 Headless: stream agent lifecycle events as NDJSON.
  --once                  Run one discovery pass and print detected agents.
  --history [n]           Print a summary of recorded past sessions.

Options:
  --demo, -d              Run with fake animated agents.
  --json                  Machine-readable JSON (for --once / --history).
  --filter <text>         Start the TUI with a session filter applied.
  --debug                 Write debug logs to ~/.ai-office/ai-office.log.
  --no-history            Do not record completed sessions to disk.
  --config <path>         Load a JSON config file.
  --scan-interval <ms>    Override process scan interval.
  --help, -h              Show this help.
  --version, -v           Show version.

TUI controls:
  q / Ctrl-C  Quit          r  Rescan now       d / o  Office ⇄ Dashboard
  tab/arrows  Select        s  Cycle sort        /      Filter sessions
  k           Signal agent  c  Show cd hint      p      Pause   h  Help

Paths:
  config   ${defaultConfigPath()}
  history  ${defaultHistoryPath()}
`);
}

function parseArgs(argv) {
  const options = {
    demo: false,
    once: false,
    json: false,
    debug: false,
    dashboard: false,
    watch: false,
    history: false,
    historyLimit: undefined,
    noHistory: false,
    filter: undefined,
    configPath: undefined,
    scanIntervalMs: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--demo' || arg === '-d') {
      options.demo = true;
    } else if (arg === '--once') {
      options.once = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '--dashboard') {
      options.dashboard = true;
    } else if (arg === '--watch') {
      options.watch = true;
    } else if (arg === '--no-history') {
      options.noHistory = true;
    } else if (arg === '--history') {
      options.history = true;
      const next = argv[index + 1];
      if (next !== undefined && /^\d+$/.test(next)) {
        options.historyLimit = Number(next);
        index += 1;
      }
    } else if (arg.startsWith('--history=')) {
      options.history = true;
      options.historyLimit = Number(arg.slice('--history='.length));
    } else if (arg === '--filter') {
      options.filter = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--filter=')) {
      options.filter = arg.slice('--filter='.length);
    } else if (arg === '--config') {
      options.configPath = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--config=')) {
      options.configPath = arg.slice('--config='.length);
    } else if (arg === '--scan-interval') {
      options.scanIntervalMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--scan-interval=')) {
      options.scanIntervalMs = Number(arg.slice('--scan-interval='.length));
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else {
      options.unknown = arg;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.version) {
    console.log(require('../package.json').version);
    return;
  }
  if (options.unknown) {
    console.error(`Unknown option: ${options.unknown}`);
    console.error('Run ai-office --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.scanIntervalMs !== undefined && (!Number.isFinite(options.scanIntervalMs) || options.scanIntervalMs < 250)) {
    console.error('--scan-interval must be a number >= 250');
    process.exitCode = 2;
    return;
  }

  const config = loadConfig(options.configPath);
  if (options.scanIntervalMs !== undefined) {
    config.scanIntervalMs = options.scanIntervalMs;
  }
  if (options.noHistory) {
    config.enableHistory = false;
  }

  if (options.history) {
    printHistorySummary(config, options);
    return;
  }

  const logger = createLogger({ debug: options.debug });
  const discovery = options.demo
    ? new DemoDiscovery({ config, logger })
    : new RealDiscovery({ config, logger });

  if (options.once) {
    const agents = await discovery.discover();
    printDiscoverySnapshot(agents, { json: options.json });
    return;
  }

  if (options.watch) {
    await runWatch({ config, discovery, logger, options });
    return;
  }

  await startTui({ config, discovery, logger, options });
}

// Headless monitor: stream lifecycle events as newline-delimited JSON. Ideal for
// logging, piping into jq, or feeding another tool. Runs until interrupted.
async function runWatch({ config, discovery, logger, options }) {
  const store = new AgentStore({ stoppedGraceMs: config.stoppedGraceMs });
  const history = new HistoryRecorder({
    filePath: config.historyPath,
    enabled: config.enableHistory !== false && !options.demo,
    logger,
  });
  let stopped = false;

  const emit = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);

  async function tick(reason) {
    if (stopped) {
      return;
    }
    try {
      const agents = await discovery.discover();
      store.update(agents);
      const events = store.drainEvents();
      history.record(events);
      for (const event of events) {
        emit({ ts: new Date(event.at).toISOString(), ...event });
      }
    } catch (error) {
      logger.error('watch scan failed', { reason, error: error.message });
      emit({ ts: new Date().toISOString(), type: 'error', message: error.message });
    }
  }

  emit({ ts: new Date().toISOString(), type: 'watch-start', scanIntervalMs: config.scanIntervalMs });
  await tick('initial');
  const timer = setInterval(() => tick('timer'), Math.max(250, config.scanIntervalMs));

  await new Promise((resolve) => {
    const finish = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(timer);
      emit({ ts: new Date().toISOString(), type: 'watch-stop' });
      resolve();
    };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

function printHistorySummary(config, { json = false, historyLimit } = {}) {
  const filePath = config.historyPath || defaultHistoryPath();
  const records = readHistory({ filePath });
  const summary = summarizeHistory(records);

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (summary.totalSessions === 0) {
    console.log(`No recorded sessions yet (${filePath}).`);
    return;
  }

  console.log(`Agent session history — ${summary.totalSessions} sessions, ${formatDuration(summary.totalRuntimeMs)} total`);
  console.log('');
  console.log('By tool:');
  for (const tool of summary.byTool) {
    console.log(`  ${pad(tool.tool, 16)} ${String(tool.sessions).padStart(4)} sessions   ${formatDuration(tool.runtimeMs)}`);
  }
  console.log('');
  console.log('Top projects:');
  for (const project of summary.byProject.slice(0, 8)) {
    console.log(`  ${pad(project.project, 28)} ${String(project.sessions).padStart(4)} sessions   ${formatDuration(project.runtimeMs)}`);
  }
  console.log('');
  const recent = historyLimit ? summary.recent.slice(0, historyLimit) : summary.recent.slice(0, 10);
  console.log('Recent sessions:');
  for (const session of recent) {
    const when = session.endedAt ? new Date(session.endedAt).toLocaleString() : '-';
    const label = session.title || session.sessionName || session.projectLabel || '-';
    console.log(`  ${when}  ${pad(session.toolName || '?', 12)} ${formatDuration(session.runtimeMs || 0)}  ${label}`);
  }
}

function printDiscoverySnapshot(agents, { json = false } = {}) {
  const snapshot = agents.map((agent) => ({
    id: agent.id,
    toolKey: agent.toolKey,
    toolName: agent.toolName,
    surface: agent.surface,
    status: agent.status || agent.statusHint,
    title: agent.title,
    sessionName: agent.sessionName,
    currentTask: agent.currentTask,
    activity: agent.activity,
    toolCall: agent.toolCall?.summary,
    projectPath: agent.projectPath,
    projectLabel: agent.projectLabel,
    tty: agent.tty,
    terminalTitle: agent.terminalTitle,
    windowTitle: agent.windowTitle,
    pid: agent.pid,
    pids: agent.pids,
    cpu: agent.cpu,
    mem: agent.mem,
    rssKb: agent.rssKb,
    runtimeMs: agent.runtimeMs,
    confidence: agent.confidence,
    metadataSource: agent.metadataSource,
    metadataConfidence: agent.metadataConfidence,
    metadataReason: agent.metadataReason,
  }));

  if (json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  if (snapshot.length === 0) {
    console.log('No agents detected.');
    return;
  }

  for (const agent of snapshot) {
    const title = agent.title || agent.sessionName || agent.projectLabel || '-';
    const activity = agent.toolCall || agent.activity || agent.status || '-';
    const metrics = [
      Number.isFinite(agent.cpu) ? `cpu ${formatPercent(agent.cpu)}` : '',
      Number.isFinite(agent.rssKb) ? `mem ${formatMemoryKb(agent.rssKb)}` : '',
      Number.isFinite(agent.runtimeMs) ? `up ${formatDuration(agent.runtimeMs)}` : '',
    ].filter(Boolean).join('  ');
    console.log(`${agent.toolName} [${agent.surface}] ${title}`);
    console.log(`  ${activity}`);
    if (agent.projectLabel || agent.projectPath) {
      console.log(`  ${agent.projectLabel || agent.projectPath}`);
    }
    console.log(`  pid ${agent.pid}${agent.pids?.length > 1 ? ` (${agent.pids.length} processes)` : ''}${metrics ? `  ·  ${metrics}` : ''}`);
  }
}

function pad(value, width) {
  const text = String(value == null ? '' : value);
  return text.length >= width ? text.slice(0, width) : text.padEnd(width, ' ');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
