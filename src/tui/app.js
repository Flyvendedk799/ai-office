const blessed = require('blessed');
const { HistoryRecorder } = require('../state/history');
const { formatDuration } = require('../util/time');
const { cleanText } = require('../util/text');
const { renderHelp } = require('./help');
const { renderOffice, createOfficeScene } = require('./office');
const { SORT_KEYS, renderDashboard, filterAgents } = require('./dashboard');
const { Workspace, scanLabel } = require('./workspace');
const { renderActivity } = require('./activity');
const { AnimationClock } = require('./motion');

async function startTui({ config, discovery, logger, options = {} }) {
  const history = new HistoryRecorder({ filePath: config.historyPath, enabled: config.enableHistory !== false && !options.demo, logger });
  const workspace = new Workspace({ config, discovery, history, logger });
  workspace.filter = String(options.filter || '');
  const { store } = workspace;
  const configuredFps = Math.max(5, Math.min(60, config.animationFps || 30));
  const clock = new AnimationClock();
  const scene = createOfficeScene();
  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: 'ai-office' });
  const view = blessed.box({ tags: true });
  const healthBar = blessed.box({ tags: false, height: 1, style: { fg: 'gray' } });
  const overlay = blessed.box({ tags: false, hidden: true, border: { type: 'line' }, style: { border: { fg: 'cyan' }, bg: 'black' } });
  screen.append(view);
  screen.append(healthBar);
  screen.append(overlay);
  screen.program.hideCursor();

  let mode = options.dashboard ? 'dashboard' : config.defaultView;
  let reducedMotion = config.reducedMotion;
  let input = null;
  let previousFilter = '';
  let showHelp = false;
  let signalTarget;
  let message = '';
  let messageUntil = 0;
  let activityOffset = 0;
  let animationTimer;
  let scanTimer;
  let lastFrame = '';
  const idleAlerted = new Set();
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  function toast(text, duration = 3000) {
    message = cleanText(text);
    messageUntil = Date.now() + duration;
  }

  function bell() {
    try { screen.program.bell(); } catch { /* Alerts must not break the UI. */ }
  }

  function render() {
    if (workspace.closed) return;
    const now = Date.now();
    const width = Math.max(1, Number(screen.width) || 80);
    const height = Math.max(1, Number(screen.height) || 24);
    const bodyHeight = Math.max(1, height - 1);
    store.expire(now);
    workspace.ensureSelection(mode);
    const order = workspace.order(mode);
    if (mode === 'activity') {
      const count = workspace.activity.filter((event) => !workspace.filter || filterAgents([event], workspace.filter).length).length;
      activityOffset = Math.min(activityOffset, Math.max(0, count - Math.max(0, bodyHeight - 3)));
    }
    view.width = width;
    view.height = bodyHeight;
    healthBar.top = height - 1;
    healthBar.width = width;
    healthBar.style.fg = workspace.health.error ? 'red' : 'gray';
    healthBar.setContent(cleanText(`${options.demo ? 'DEMO · ' : ''}${scanLabel(workspace.health, now)}${clock.paused ? ' · animation paused' : ''}${reducedMotion ? ' · reduced motion' : ''}`).slice(0, width));
    const frame = mode === 'activity'
      ? renderActivity({ events: workspace.activity, width, height: bodyHeight, filter: workspace.filter, offset: activityOffset })
      : mode === 'dashboard'
        ? renderDashboard({ agents: order, width, height: bodyHeight, now, selectedId: store.selectedId, sortKey: workspace.sortKey, filter: workspace.filter, totals: store.totals(), cpuHistory: store.cpuHistory })
        : renderOffice({ agents: order, allAgents: store.list(), width, height: bodyHeight, now: clock.time(now), realNow: now, scene, selectedId: store.selectedId, paused: clock.paused, reducedMotion, filter: workspace.filter });
    if (frame !== lastFrame) { view.setContent(frame); lastFrame = frame; }

    overlay.hidden = true;
    let content;
    if (showHelp) content = renderHelp().replace(/\{[^}]*\}/g, '');
    else if (input === 'filter') content = `Filter: ${workspace.filter}_\nEnter apply · Esc cancel`;
    else if (input === 'signal') content = `Signal ${signalTarget.toolName} · ${signalTarget.title || signalTarget.sessionName || signalTarget.pid}\nPIDs: ${signalTarget.pids.join(', ')}\nt TERM · i INT · 9 KILL · Esc cancel`;
    else if (message && now < messageUntil) content = message;
    if (content) {
      overlay.width = Math.max(1, Math.min(width, showHelp ? 78 : 70));
      overlay.height = Math.max(1, Math.min(bodyHeight, content.split('\n').length + 2));
      overlay.left = Math.max(0, Math.floor((width - overlay.width) / 2));
      overlay.top = Math.max(0, showHelp || input === 'signal' ? Math.floor((bodyHeight - overlay.height) / 2) : bodyHeight - overlay.height - 1);
      overlay.style.border.fg = input === 'signal' ? 'red' : 'cyan';
      overlay.setContent(String(content).split('\n').map(cleanText).join('\n'));
      overlay.hidden = false;
    }
    screen.render();
  }

  async function rescan() {
    const pending = workspace.scan();
    render();
    const events = await pending;
    if (workspace.closed) return;
    for (const event of events.filter((event) => event.type === 'stopped')) {
      toast(`${event.toolName}: ${event.title || event.sessionName || event.pid} exited (${formatDuration(event.runtimeMs)})`);
      if (config.bellOnFinish) bell();
    }
    for (const agent of store.list()) {
      if (config.idleAlertMs > 0 && agent.status === 'idle' && Date.now() - agent.statusChangedAt >= config.idleAlertMs) {
        if (!idleAlerted.has(agent.id)) {
          idleAlerted.add(agent.id);
          toast(`${agent.toolName}: idle ${formatDuration(Date.now() - agent.statusChangedAt)}`);
          if (config.bellOnFinish) bell();
        }
      } else idleAlerted.delete(agent.id);
    }
    for (const id of idleAlerted) if (!store.get(id)) idleAlerted.delete(id);
    render();
  }

  function shutdown() {
    if (workspace.closed) return;
    workspace.closed = true;
    clearInterval(animationTimer);
    clearInterval(scanTimer);
    process.removeListener('SIGTERM', shutdown);
    screen.program.showCursor();
    screen.destroy();
    resolveDone();
  }

  function beginSignal() {
    const target = workspace.selected(mode);
    if (mode === 'activity' || !target || target.status === 'stopped') return toast('Select a live agent first');
    signalTarget = { ...target, pids: (target.pids?.length ? target.pids : [target.pid]).slice() };
    input = 'signal';
  }

  function applySignal(signal) {
    input = null;
    const target = store.get(signalTarget.id);
    const startDrift = Math.abs((target?.startedAt || 0) - (signalTarget.startedAt || 0));
    if (!target || target.status === 'stopped' || target.pid !== signalTarget.pid || startDrift > 2000) return toast('Agent changed or exited; signal cancelled');
    const pids = [...new Set(signalTarget.pids)].filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    if (options.demo) return toast(`Demo: would send ${signal} to ${pids.join(', ')}`);
    let sent = 0;
    for (const pid of pids) {
      try { process.kill(pid, signal); sent++; }
      catch (error) { logger.warn('signal failed', { pid, signal, error: error.message }); }
    }
    toast(`${signal}: ${sent}/${pids.length} processes signalled`);
    void rescan();
  }

  // A single dispatcher keeps prompt keys from also triggering shortcuts.
  screen.on('keypress', (ch, key = {}) => {
    if (key.ctrl && key.name === 'c') return shutdown();
    if (input === 'filter') {
      if (['return', 'enter'].includes(key.name)) input = null;
      else if (key.name === 'escape') { workspace.filter = previousFilter; input = null; }
      else if (key.name === 'backspace') workspace.filter = Array.from(workspace.filter).slice(0, -1).join('');
      else if (ch && !key.ctrl && !key.meta && ch >= ' ') workspace.filter += ch;
      activityOffset = 0;
    } else if (input === 'signal') {
      if (key.name === 'escape') input = null;
      else if (ch === 't') applySignal('SIGTERM');
      else if (ch === 'i') applySignal('SIGINT');
      else if (ch === '9') applySignal('SIGKILL');
    } else if (showHelp) {
      if (['escape', 'h', 'q'].includes(key.name)) showHelp = false;
    } else {
      switch (key.name || ch) {
        case 'q': return shutdown();
        case 'r': void rescan(); break;
        case 'd': mode = 'dashboard'; break;
        case 'o': mode = 'office'; break;
        case 'e': mode = 'activity'; activityOffset = 0; break;
        case 's': workspace.sortKey = SORT_KEYS[(SORT_KEYS.indexOf(workspace.sortKey) + 1) % SORT_KEYS.length]; break;
        case 'tab': case 'right': case 'down':
          if (mode === 'activity') activityOffset++; else workspace.move(1, mode);
          break;
        case 'left': case 'up':
          if (mode === 'activity') activityOffset = Math.max(0, activityOffset - 1); else workspace.move(-1, mode);
          break;
        case 'p': clock.toggle(); break;
        case 'm': reducedMotion = !reducedMotion; break;
        case 'h': showHelp = true; break;
        case 'k': beginSignal(); break;
        case 'c': {
          const path = workspace.selected(mode)?.projectPath;
          toast(path ? cdCommand(path) : 'No project path for this agent', 6000);
          break;
        }
        case '/': previousFilter = workspace.filter; input = 'filter'; break;
        case 'escape': workspace.filter = ''; break;
      }
    }
    render();
  });
  screen.on('resize', () => { lastFrame = ''; render(); });
  screen.on('destroy', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await rescan();
    if (!workspace.closed) {
      animationTimer = setInterval(render, Math.round(1000 / configuredFps));
      scanTimer = setInterval(() => void rescan(), Math.max(250, config.scanIntervalMs));
    }
    await done;
  } finally { shutdown(); }
}

function cdCommand(path, platform = process.platform) {
  return platform === 'win32' ? `Set-Location -LiteralPath '${path.replace(/'/g, "''")}'` : `cd -- '${path.replace(/'/g, "'\\''")}'`;
}

module.exports = { startTui, cdCommand };
