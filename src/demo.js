class DemoDiscovery {
  constructor({ logger }) {
    this.logger = logger;
    this.startedAt = Date.now();
    this.agents = [
      {
        id: 'demo-codex-terminal',
        toolKey: 'codex-cli',
        toolName: 'Codex CLI',
        surface: 'terminal',
        icon: 'C',
        color: 'cyan',
        sessionName: 'refactor auth middleware',
        title: 'Auth middleware refactor',
        currentTask: 'untangle auth middleware and preserve request context',
        activity: 'editing route guard',
        toolCall: { shortName: 'edit', summary: 'edit middleware.js', activity: 'edit middleware.js', status: 'running' },
        projectPath: '/Users/demo/work/api-refactor',
        projectLabel: '~/work/api-refactor',
        pid: 4201,
        pids: [4201],
        parentPid: 311,
        command: 'codex --cwd /Users/demo/work/api-refactor',
        processName: 'codex',
        source: 'demo',
        confidence: 1,
        enterAt: 1200,
      },
      {
        id: 'demo-claude-terminal',
        toolKey: 'claude-code',
        toolName: 'Claude Code',
        surface: 'terminal',
        icon: 'X',
        color: 'yellow',
        sessionName: 'write tests for cart reducer',
        title: 'Cart reducer tests',
        currentTask: 'write edge-case tests for cart totals',
        activity: 'shell npm test',
        toolCall: { shortName: 'shell', summary: 'shell npm test', activity: 'shell npm test', status: 'running' },
        projectPath: '/Users/demo/work/cart',
        projectLabel: '~/work/cart',
        pid: 5102,
        pids: [5102],
        parentPid: 299,
        command: 'claude --project /Users/demo/work/cart',
        processName: 'claude',
        source: 'demo',
        confidence: 1,
        enterAt: -16000,
      },
      {
        id: 'demo-cursor-desktop',
        toolKey: 'cursor',
        toolName: 'Cursor',
        surface: 'desktop',
        icon: 'C',
        color: 'magenta',
        sessionName: 'tailwind v4 migration',
        title: 'Tailwind v4 migration',
        currentTask: 'update app shell styles and config',
        activity: 'workspace open',
        projectPath: '/Users/demo/work/site',
        projectLabel: '~/work/site',
        pid: 6188,
        pids: [6188, 6189, 6190],
        parentPid: 1,
        command: '/Applications/Cursor.app/Contents/MacOS/Cursor /Users/demo/work/site',
        processName: 'Cursor',
        source: 'demo',
        confidence: 1,
        enterAt: -18000,
      },
      {
        id: 'demo-claude-desktop',
        toolKey: 'claude-desktop',
        toolName: 'Claude Desktop',
        surface: 'desktop',
        icon: '?',
        color: 'yellow',
        sessionName: 'fix flaky e2e checkout spec',
        title: 'Checkout flake',
        currentTask: 'investigate browser timing in checkout e2e',
        activity: 'reading logs',
        projectPath: '/Users/demo/work/checkout',
        projectLabel: '~/work/checkout',
        pid: 7330,
        pids: [7330],
        parentPid: 1,
        command: '/Applications/Claude.app/Contents/MacOS/Claude /Users/demo/work/checkout',
        processName: 'Claude',
        source: 'demo',
        confidence: 1,
        enterAt: -22000,
      },
      {
        id: 'demo-codex-desktop',
        toolKey: 'codex-desktop',
        toolName: 'Codex Desktop',
        surface: 'desktop',
        icon: 'A',
        color: 'cyan',
        sessionName: 'draft openapi for billing',
        title: 'Billing OpenAPI',
        currentTask: 'draft billing endpoints and schema names',
        activity: 'thinking',
        projectPath: '/Users/demo/work/billing',
        projectLabel: '~/work/billing',
        pid: 7440,
        pids: [7440],
        parentPid: 1,
        command: '/Applications/Codex.app/Contents/MacOS/Codex /Users/demo/work/billing',
        processName: 'Codex',
        source: 'demo',
        confidence: 1,
        enterAt: -24000,
      },
      {
        id: 'demo-cursor-worker',
        toolKey: 'cursor',
        toolName: 'Cursor',
        surface: 'desktop',
        icon: 'G',
        color: 'magenta',
        sessionName: 'investigate memleak in worker',
        title: 'Worker memleak',
        currentTask: 'profile worker heap growth',
        activity: 'search heap snapshots',
        toolCall: { shortName: 'search', summary: 'search heap snapshots', activity: 'search heap snapshots', status: 'running' },
        projectPath: '/Users/demo/work/worker',
        projectLabel: '~/work/worker',
        pid: 7550,
        pids: [7550, 7551],
        parentPid: 1,
        command: '/Applications/Cursor.app/Contents/MacOS/Cursor /Users/demo/work/worker',
        processName: 'Cursor',
        source: 'demo',
        confidence: 1,
        enterAt: -14000,
        leaveAt: 10000,
      },
      {
        id: 'demo-claude-rsc',
        toolKey: 'claude-code',
        toolName: 'Claude Code',
        surface: 'terminal',
        icon: 'C',
        color: 'yellow',
        sessionName: 'port settings page to rsc',
        title: 'Settings RSC port',
        currentTask: 'move settings page data loading server-side',
        activity: 'edit settings/page.tsx',
        toolCall: { shortName: 'edit', summary: 'edit page.tsx', activity: 'edit page.tsx', status: 'running' },
        projectPath: '/Users/demo/work/settings',
        projectLabel: '~/work/settings',
        pid: 7660,
        pids: [7660],
        parentPid: 299,
        command: 'claude --project /Users/demo/work/settings',
        processName: 'claude',
        source: 'demo',
        confidence: 1,
        enterAt: -28000,
      },
    ];
  }

  async discover(now = Date.now()) {
    const elapsed = now - this.startedAt;
    const cycle = elapsed % 42000;
    const visible = this.agents
      .filter((agent) => cycle >= agent.enterAt && (!agent.leaveAt || cycle < agent.leaveAt))
      .map((agent, index) => {
        const status = demoStatus(agent.id, cycle, index, this.startedAt);
        const metrics = demoMetrics(index, status.name, cycle);
        return {
          ...agent,
          startedAt: this.startedAt + agent.enterAt,
          appearAt: this.startedAt + agent.enterAt,
          runtimeMs: Math.max(0, elapsed - agent.enterAt),
          statusHint: status.name,
          statusChangedAt: status.changedAt,
          cpu: metrics.cpu,
          mem: metrics.mem,
          rssKb: metrics.rssKb,
        };
      });

    this.logger?.debug('demo discovery tick', { count: visible.length });
    return visible;
  }
}

function demoMetrics(index, status, cycle) {
  const baseRss = [180000, 320000, 540000, 410000, 260000, 480000, 210000][index % 7];
  if (status === 'idle') {
    const wobble = Math.abs(Math.sin((cycle + index * 900) / 2600)) * 3;
    return { cpu: Math.round((0.3 + wobble) * 10) / 10, mem: 1 + index * 0.4, rssKb: baseRss };
  }
  const wave = Math.abs(Math.sin((cycle + index * 1400) / 1700));
  const cpu = 8 + index * 5 + wave * 55;
  return { cpu: Math.round(cpu * 10) / 10, mem: 1 + index * 0.5, rssKb: baseRss + Math.round(wave * 40000) };
}

function demoStatus(id, cycle, index, startedAt) {
  if (id === 'demo-codex-terminal') {
    return { name: 'active', changedAt: startedAt + 1200 };
  }
  if (id === 'demo-claude-terminal') {
    return { name: 'active', changedAt: startedAt - 16000 };
  }
  if (id === 'demo-cursor-desktop') {
    return cycle < 5200
      ? { name: 'active', changedAt: startedAt - 18000 }
      : { name: 'idle', changedAt: startedAt + 5200 };
  }
  if (id === 'demo-claude-desktop') {
    return { name: 'idle', changedAt: startedAt - 9000 };
  }
  if (id === 'demo-codex-desktop') {
    return { name: 'active', changedAt: startedAt - 24000 };
  }
  if (id === 'demo-cursor-worker') {
    return { name: 'active', changedAt: startedAt - 14000 };
  }
  const idle = Math.floor((cycle + index * 700) / 3500) % 3 === 0;
  return { name: idle ? 'idle' : 'active', changedAt: startedAt + Math.max(0, cycle - 2000) };
}

module.exports = {
  DemoDiscovery,
};
