const MAX_CPU_HISTORY = 60;

class AgentStore {
  constructor({ stoppedGraceMs = 10000, startingMs = 2500, maxCpuHistory = MAX_CPU_HISTORY } = {}) {
    this.stoppedGraceMs = stoppedGraceMs;
    this.startingMs = startingMs;
    this.maxCpuHistory = maxCpuHistory;
    this.agents = new Map();
    this.selectedId = undefined;
    this.events = [];
    this.cpuHistory = [];
  }

  update(candidates, now = Date.now()) {
    const seenIds = new Set();

    for (const candidate of candidates) {
      seenIds.add(candidate.id);
      const existing = this.agents.get(candidate.id);
      if (!existing) {
        const appearAt = candidate.appearAt ?? now;
        const age = now - appearAt;
        const hintedStatus = candidate.statusHint || candidate.status || 'active';
        const status = age < this.startingMs ? 'starting' : hintedStatus;
        const entry = {
          ...candidate,
          appearAt,
          lastSeenAt: now,
          stoppedAt: undefined,
          deskIndex: this.nextDeskIndex(),
          status,
          previousStatus: undefined,
          statusChangedAt: candidate.statusChangedAt ?? (status === 'starting' ? now : appearAt),
          cpuHistory: [Number.isFinite(candidate.cpu) ? candidate.cpu : 0],
        };
        this.agents.set(candidate.id, entry);
        this.recordEvent('started', entry, now);
        continue;
      }

      const age = now - existing.appearAt;
      const status = age < this.startingMs ? 'starting' : candidate.statusHint || 'active';
      const statusChanged = status !== existing.status;
      const cpuHistory = pushCapped(existing.cpuHistory, Number.isFinite(candidate.cpu) ? candidate.cpu : 0, this.maxCpuHistory);
      const updated = {
        ...existing,
        ...candidate,
        appearAt: existing.appearAt,
        deskIndex: existing.deskIndex,
        lastSeenAt: now,
        stoppedAt: undefined,
        status,
        previousStatus: statusChanged ? existing.status : existing.previousStatus,
        statusChangedAt: statusChanged ? now : existing.statusChangedAt,
        cpuHistory,
      };
      this.agents.set(candidate.id, updated);
      if (statusChanged) {
        this.recordEvent('status', updated, now);
      }
    }

    for (const agent of this.agents.values()) {
      if (!seenIds.has(agent.id) && !agent.stoppedAt) {
        agent.stoppedAt = now;
        agent.statusBeforeStop = agent.status;
        agent.previousStatus = agent.status;
        agent.statusChangedAt = now;
        agent.status = 'stopped';
        this.recordEvent('stopped', agent, now);
      }
    }

    this.cpuHistory = pushCapped(this.cpuHistory, this.totals().cpu, this.maxCpuHistory);
    this.expire(now);
    this.ensureSelection();
  }

  recordEvent(type, agent, now) {
    this.events.push({
      type,
      at: now,
      agentId: agent.id,
      toolKey: agent.toolKey,
      toolName: agent.toolName,
      surface: agent.surface,
      sessionName: agent.sessionName,
      title: agent.title,
      projectPath: agent.projectPath,
      projectLabel: agent.projectLabel,
      status: agent.status,
      previousStatus: agent.previousStatus,
      pid: agent.pid,
      runtimeMs: Number.isFinite(agent.startedAt) ? Math.max(0, now - agent.startedAt) : agent.runtimeMs,
    });
    // Avoid unbounded growth if a consumer never drains.
    if (this.events.length > 500) {
      this.events.splice(0, this.events.length - 500);
    }
  }

  // Returns and clears accumulated lifecycle events.
  drainEvents() {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  expire(now = Date.now()) {
    for (const [id, agent] of this.agents.entries()) {
      if (agent.stoppedAt && now - agent.stoppedAt > this.stoppedGraceMs) {
        this.agents.delete(id);
      }
    }
    this.ensureSelection();
  }

  totals() {
    let working = 0;
    let idle = 0;
    let stopped = 0;
    let cpu = 0;
    let mem = 0;
    let rssKb = 0;
    for (const agent of this.agents.values()) {
      if (agent.stoppedAt || agent.status === 'stopped') {
        stopped += 1;
      } else if (agent.status === 'idle') {
        idle += 1;
      } else {
        working += 1;
      }
      if (Number.isFinite(agent.cpu)) cpu += agent.cpu;
      if (Number.isFinite(agent.mem)) mem += agent.mem;
      if (Number.isFinite(agent.rssKb)) rssKb += agent.rssKb;
    }
    return {
      agents: working + idle,
      working,
      idle,
      stopped,
      cpu: Math.round(cpu * 10) / 10,
      mem: Math.round(mem * 10) / 10,
      rssKb,
    };
  }

  list() {
    return [...this.agents.values()].sort((a, b) => a.deskIndex - b.deskIndex);
  }

  activeList() {
    return this.list().filter((agent) => !agent.stoppedAt);
  }

  get(id) {
    return this.agents.get(id);
  }

  selected() {
    if (!this.selectedId) {
      return undefined;
    }
    return this.agents.get(this.selectedId);
  }

  select(id) {
    if (this.agents.has(id)) {
      this.selectedId = id;
      return this.agents.get(id);
    }
    return undefined;
  }

  // Select relative to an explicit ordering (defaults to desk order).
  selectNext(delta = 1, order) {
    const agents = order && order.length ? order : this.list();
    if (agents.length === 0) {
      this.selectedId = undefined;
      return undefined;
    }

    const currentIndex = Math.max(0, agents.findIndex((agent) => agent.id === this.selectedId));
    const nextIndex = (currentIndex + delta + agents.length) % agents.length;
    this.selectedId = agents[nextIndex].id;
    return agents[nextIndex];
  }

  ensureSelection() {
    const agents = this.list();
    if (agents.length === 0) {
      this.selectedId = undefined;
      return;
    }
    if (!this.selectedId || !this.agents.has(this.selectedId)) {
      const firstLive = agents.find((agent) => !agent.stoppedAt) || agents[0];
      this.selectedId = firstLive.id;
    }
  }

  nextDeskIndex() {
    const used = new Set([...this.agents.values()].map((agent) => agent.deskIndex));
    for (let index = 0; index < 200; index += 1) {
      if (!used.has(index)) {
        return index;
      }
    }
    return this.agents.size;
  }
}

function pushCapped(list, value, max) {
  const next = Array.isArray(list) ? list.slice() : [];
  next.push(value);
  while (next.length > max) {
    next.shift();
  }
  return next;
}

module.exports = {
  AgentStore,
};
