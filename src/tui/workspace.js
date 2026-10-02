const { AgentStore } = require('../state/store');
const { filterAgents, sortAgents } = require('./dashboard');

// User focus and discovery health are independent of the animation clock.
class Workspace {
  constructor({ config, discovery, history, logger, now = Date.now } = {}) {
    this.store = new AgentStore({ stoppedGraceMs: config.stoppedGraceMs });
    this.discovery = discovery;
    this.history = history;
    this.logger = logger;
    this.now = now;
    this.filter = '';
    this.sortKey = 'cpu';
    this.activity = [];
    this.health = { scanning: false, lastSuccessAt: null, error: '', durationMs: 0 };
    this.closed = false;
  }

  order(view = 'office') {
    const agents = filterAgents(this.store.list(), this.filter);
    return view === 'dashboard' ? sortAgents(agents, this.sortKey, this.now()) : agents;
  }

  selected(view) {
    return this.order(view).find((agent) => agent.id === this.store.selectedId);
  }

  ensureSelection(view) {
    const order = this.order(view);
    if (order.length && !this.selected(view)) this.store.select(order[0].id);
  }

  move(delta, view) {
    this.store.selectNext(delta, this.order(view));
  }

  addEvents(events) {
    this.activity.unshift(...events.slice().reverse());
    this.activity.length = Math.min(this.activity.length, 200);
  }

  async scan() {
    if (this.health.scanning || this.closed) return [];
    this.health.scanning = true;
    const started = this.now();
    try {
      const candidates = await this.discovery.discover();
      if (this.closed) return [];
      this.store.update(candidates, this.now());
      const events = this.store.drainEvents();
      this.history?.record(events);
      this.addEvents(events);
      this.health.lastSuccessAt = this.now();
      this.health.error = '';
      return events;
    } catch (error) {
      if (this.closed) return [];
      this.health.error = error.message;
      this.logger?.error('rescan failed', { error: error.message });
      this.addEvents([{ type: 'error', at: this.now(), message: error.message }]);
      // Preserve the last good snapshot. A failed scan is not a mass exit.
      return [];
    } finally {
      this.health.scanning = false;
      this.health.durationMs = this.now() - started;
    }
  }
}

function scanLabel(health, now = Date.now()) {
  if (health.error) return `SCAN FAILED · r retry · ${health.error}`;
  if (health.lastSuccessAt === null) return 'Discovering local agents…';
  const age = Math.max(0, Math.floor((now - health.lastSuccessAt) / 1000));
  return `${health.scanning ? 'Scanning' : 'Live'} · updated ${age}s ago · ${health.durationMs}ms`;
}

module.exports = { Workspace, scanLabel };
