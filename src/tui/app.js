const blessed = require('blessed');
const { AgentStore } = require('../state/store');
const { HistoryRecorder } = require('../state/history');
const { formatDuration } = require('../util/time');
const { renderHelp } = require('./help');
const { renderOffice } = require('./office');
const {
  SORT_KEYS,
  filterAgents,
  renderDashboard,
  sortAgents,
} = require('./dashboard');

async function startTui({ config, discovery, logger, options }) {
  const store = new AgentStore({ stoppedGraceMs: config.stoppedGraceMs });
  const history = new HistoryRecorder({
    filePath: config.historyPath,
    enabled: config.enableHistory !== false && !options.demo,
    logger,
  });

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'ai-office',
  });

  const view = blessed.box({ tags: true, scrollable: false });

  const help = blessed.box({
    tags: true,
    hidden: true,
    top: 'center',
    left: 'center',
    width: '78%',
    height: 18,
    content: renderHelp(),
    border: { type: 'line' },
    style: { border: { fg: 'yellow' }, bg: 'black' },
  });

  const prompt = blessed.box({
    tags: true,
    hidden: true,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' }, bg: 'black' },
  });

  screen.append(view);
  screen.append(help);
  screen.append(prompt);
  screen.program.hideCursor();

  let viewMode = options.dashboard ? 'dashboard' : (config.defaultView || 'office');
  let paused = false;
  let pausedAt = Date.now();
  let closed = false;
  let scanInFlight = false;
  let lastScanLabel = 'never';
  let sortKey = 'cpu';
  let filter = String(options.filter || '');
  let inputMode = null; // null | 'filter' | 'signal'
  let signalTargetId;
  let message = '';
  let messageUntil = 0;
  let animationTimer;
  let scanTimer;
  let lastUserSelectionAt = 0;
  let nextAutoFocusAt = Date.now() + 6000;
  const idleAlerted = new Set();

  function toast(text, ms = 2800) {
    message = text;
    messageUntil = Date.now() + ms;
  }

  function bell() {
    try {
      if (screen.program && typeof screen.program.bell === 'function') {
        screen.program.bell();
      } else {
        process.stdout.write('\x07');
      }
    } catch {
      // Never let an alert break the UI.
    }
  }

  function dimensions() {
    return {
      width: numericSize(screen.width, 100),
      height: numericSize(screen.height, 32),
    };
  }

  function currentOrder() {
    const all = store.list();
    if (viewMode === 'dashboard') {
      return sortAgents(filterAgents(all, filter), sortKey, Date.now());
    }
    return filter ? filterAgents(all, filter) : all;
  }

  function layout() {
    const { width, height } = dimensions();
    view.top = 0;
    view.left = 0;
    view.width = width;
    view.height = height;
  }

  function render() {
    const now = Date.now();
    const visualNow = paused ? pausedAt : now;
    store.expire(now);
    layout();
    const { width, height } = dimensions();

    const order = currentOrder();
    if (order.length && !order.some((agent) => agent.id === store.selectedId)) {
      store.select(order[0].id);
    }
    maybeAutoFocus(now, order);

    if (viewMode === 'dashboard') {
      view.setContent(renderDashboard({
        agents: order,
        width,
        height,
        now,
        selectedId: store.selectedId,
        sortKey,
        filter,
        totals: store.totals(),
        cpuHistory: store.cpuHistory,
        paused,
      }));
    } else {
      view.setContent(renderOffice({
        agents: order,
        width,
        height,
        now: visualNow,
        selectedId: store.selectedId,
        paused,
        filter,
      }));
    }

    updateOverlays(now);
    screen.render();
  }

  function updateOverlays(now) {
    const { width, height } = dimensions();

    if (!help.hidden) {
      prompt.hidden = true;
      return;
    }

    if (inputMode === 'signal') {
      const target = store.get(signalTargetId);
      const name = target ? `${target.toolName} · ${target.sessionName || target.pid}` : 'agent';
      prompt.width = Math.min(width - 4, 64);
      prompt.height = 5;
      prompt.top = Math.max(1, Math.floor(height / 2) - 2);
      prompt.left = 'center';
      prompt.style.border.fg = 'red';
      prompt.setContent([
        `{bold}Signal ${escapeTag(name)}{/bold}`,
        '',
        '{red-fg}t{/} SIGTERM   {yellow-fg}i{/} SIGINT   {red-fg}9{/} SIGKILL   esc cancel',
      ].join('\n'));
      prompt.hidden = false;
      return;
    }

    if (inputMode === 'filter') {
      prompt.width = Math.min(width - 4, 60);
      prompt.height = 3;
      prompt.top = height - 4;
      prompt.left = 'center';
      prompt.style.border.fg = 'cyan';
      prompt.setContent(`filter: ${escapeTag(filter)}{cyan-fg}▏{/}   (enter apply · esc clear)`);
      prompt.hidden = false;
      return;
    }

    if (message && now < messageUntil) {
      prompt.width = Math.min(width - 4, Math.max(20, message.length + 4));
      prompt.height = 3;
      prompt.top = height - 4;
      prompt.left = 'center';
      prompt.style.border.fg = 'cyan';
      prompt.setContent(`{center}${escapeTag(message)}{/center}`);
      prompt.hidden = false;
      return;
    }

    prompt.hidden = true;
  }

  function maybeAutoFocus(now, order) {
    if (
      viewMode !== 'office'
      || inputMode
      || filter
      || order.length < 2
      || now - lastUserSelectionAt < 6000
      || now < nextAutoFocusAt
    ) {
      return;
    }
    store.selectNext(1, order);
    nextAutoFocusAt = now + 4000;
  }

  function handleEvents(events) {
    if (!events.length) {
      return;
    }
    history.record(events);
    const finished = events.filter((event) => event.type === 'stopped');
    for (const event of finished) {
      const name = event.title || event.sessionName || event.toolName;
      toast(`✗ ${event.toolName}: ${truncateMessage(name)} finished (${formatDuration(event.runtimeMs || 0)})`);
      if (config.bellOnFinish) {
        bell();
      }
    }
  }

  function checkIdleAlerts(now) {
    if (!config.idleAlertMs || config.idleAlertMs <= 0) {
      return;
    }
    for (const agent of store.list()) {
      if (agent.status === 'idle' && now - (agent.statusChangedAt || now) >= config.idleAlertMs) {
        if (!idleAlerted.has(agent.id)) {
          idleAlerted.add(agent.id);
          toast(`⏸ ${agent.toolName}: ${truncateMessage(agent.sessionName || agent.title || agent.pid)} idle ${formatDuration(now - agent.statusChangedAt)}`);
          if (config.bellOnFinish) {
            bell();
          }
        }
      } else if (agent.status !== 'idle') {
        idleAlerted.delete(agent.id);
      }
    }
  }

  async function rescan(reason = 'timer') {
    if (scanInFlight || closed) {
      return;
    }
    scanInFlight = true;
    try {
      const agents = await discovery.discover();
      store.update(agents);
      handleEvents(store.drainEvents());
      checkIdleAlerts(Date.now());
      lastScanLabel = new Date().toLocaleTimeString();
      logger.debug('rescan applied', { reason, agents: agents.length });
    } catch (error) {
      logger.error('rescan failed', { reason, error: error.message });
      lastScanLabel = 'error';
    } finally {
      scanInFlight = false;
      render();
    }
  }

  function moveSelection(delta) {
    store.selectNext(delta, currentOrder());
    lastUserSelectionAt = Date.now();
    nextAutoFocusAt = lastUserSelectionAt + 6000;
    render();
  }

  function toggleView() {
    viewMode = viewMode === 'office' ? 'dashboard' : 'office';
    toast(viewMode === 'dashboard' ? 'dashboard view' : 'office view', 1400);
    render();
  }

  function cycleSort() {
    const index = SORT_KEYS.indexOf(sortKey);
    sortKey = SORT_KEYS[(index + 1) % SORT_KEYS.length];
    toast(`sort: ${sortKey}`, 1400);
    render();
  }

  function beginSignal() {
    const target = store.selected();
    if (!target) {
      toast('No agent selected');
      render();
      return;
    }
    signalTargetId = target.id;
    inputMode = 'signal';
    render();
  }

  function applySignal(signal) {
    const target = store.get(signalTargetId);
    inputMode = null;
    signalTargetId = undefined;
    if (!target) {
      render();
      return;
    }
    const pids = (target.pids && target.pids.length ? target.pids : [target.pid]).filter(Boolean);
    if (options.demo) {
      toast(`(demo) would send ${signal} to ${target.toolName} [${pids.join(', ')}]`);
      render();
      return;
    }
    let ok = 0;
    let fail = 0;
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
        ok += 1;
      } catch (error) {
        fail += 1;
        logger.warn('signal failed', { pid, signal, error: error.message });
      }
    }
    toast(`${signal} → ${target.toolName} (${ok} pid${ok === 1 ? '' : 's'}${fail ? `, ${fail} failed` : ''})`);
    render();
    rescan('signal');
  }

  function showCdHint() {
    const target = store.selected();
    const path = target?.projectPath || target?.projectLabel;
    toast(path ? `cd ${path}` : 'No project path for this agent', 4000);
    render();
  }

  function handleFilterKey(ch, key) {
    const name = key && key.name;
    if (name === 'return' || name === 'enter') {
      inputMode = null;
    } else if (name === 'escape') {
      filter = '';
      inputMode = null;
    } else if (name === 'backspace') {
      filter = filter.slice(0, -1);
    } else if (ch && ch.length === 1 && ch >= ' ' && !(key && key.ctrl)) {
      filter += ch;
    }
    render();
  }

  function handleSignalKey(ch, key) {
    const name = key && key.name;
    if (name === 'escape') {
      inputMode = null;
      signalTargetId = undefined;
      toast('signal cancelled', 1200);
      render();
      return;
    }
    if (ch === 't') return applySignal('SIGTERM');
    if (ch === 'i') return applySignal('SIGINT');
    if (ch === '9' || ch === 'k') return applySignal('SIGKILL');
  }

  function shutdown() {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(animationTimer);
    clearInterval(scanTimer);
    screen.program.showCursor();
    screen.destroy();
  }

  // The global keypress listener is registered BEFORE the named key bindings so
  // that the keystroke that opens an input mode is not also captured as input.
  screen.on('keypress', (ch, key) => {
    if (inputMode === 'filter') {
      handleFilterKey(ch, key);
    } else if (inputMode === 'signal') {
      handleSignalKey(ch, key);
    }
  });

  const gated = (handler) => () => {
    if (inputMode) {
      return;
    }
    handler();
  };

  screen.key('C-c', shutdown);
  screen.key('q', gated(shutdown));
  screen.key('r', gated(() => rescan('manual')));
  screen.key(['tab', 'right', 'down'], gated(() => moveSelection(1)));
  screen.key(['left', 'up'], gated(() => moveSelection(-1)));
  screen.key('h', gated(() => { help.hidden = !help.hidden; render(); }));
  screen.key('p', gated(() => { paused = !paused; pausedAt = Date.now(); render(); }));
  screen.key(['d', 'o'], gated(toggleView));
  screen.key('s', gated(cycleSort));
  screen.key('k', gated(beginSignal));
  screen.key('c', gated(showCdHint));
  screen.key('/', gated(() => { inputMode = 'filter'; render(); }));
  screen.key('escape', gated(() => {
    if (!help.hidden) {
      help.hidden = true;
    } else if (filter) {
      filter = '';
    }
    render();
  }));
  screen.on('resize', render);

  await rescan('initial');
  animationTimer = setInterval(render, 100);
  scanTimer = setInterval(() => rescan('timer'), Math.max(250, config.scanIntervalMs));

  return new Promise((resolve) => {
    screen.on('destroy', resolve);
  });
}

function numericSize(value, fallback) {
  if (typeof value === 'number') {
    return value;
  }
  return Number(value) || fallback || 80;
}

function truncateMessage(value, max = 28) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeTag(value) {
  return String(value == null ? '' : value).replace(/[{}]/g, '');
}

module.exports = {
  startTui,
};
