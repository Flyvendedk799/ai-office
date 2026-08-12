const { formatDuration } = require('../util/time');
const { truncate } = require('../util/text');
const { formatMemoryKb, formatPercent, sparkline } = require('../util/format');

const SORT_KEYS = ['cpu', 'mem', 'runtime', 'tool', 'status', 'name'];

const STATUS_COLOR = {
  active: 'green',
  starting: 'cyan',
  idle: 'magenta',
  stopped: 'gray',
  unknown: 'gray',
};

const STATUS_ORDER = { active: 0, starting: 1, idle: 2, unknown: 3, stopped: 4 };

// Columns are laid out left-to-right. Optional columns are dropped (lowest
// `drop` first) until the remaining set fits the terminal width; leftover space
// is distributed to flex columns by weight.
const COLUMNS = [
  { key: 'marker', width: 1, align: 'left' },
  { key: 'status', label: 'STATUS', width: 8, align: 'left' },
  { key: 'tool', label: 'TOOL', width: 9, align: 'left' },
  { key: 'name', label: 'SESSION', flex: true, min: 10, weight: 2, align: 'left' },
  { key: 'cpu', label: 'CPU', width: 5, align: 'right', optional: true, drop: 5 },
  { key: 'mem', label: 'MEM', width: 6, align: 'right', optional: true, drop: 4 },
  { key: 'run', label: 'RUNTIME', width: 8, align: 'right', optional: true, drop: 3 },
  { key: 'pid', label: 'PID', width: 6, align: 'right', optional: true, drop: 2 },
  { key: 'project', label: 'PROJECT', flex: true, min: 12, weight: 1, align: 'left', optional: true, drop: 6 },
  { key: 'task', label: 'TASK', flex: true, min: 12, weight: 3, align: 'left', optional: true, drop: 1 },
];

function agentRuntimeMs(agent, now) {
  if (Number.isFinite(agent.startedAt)) {
    return Math.max(0, now - agent.startedAt);
  }
  return Number.isFinite(agent.runtimeMs) ? agent.runtimeMs : 0;
}

function sortAgents(agents, sortKey = 'cpu', now = Date.now()) {
  const list = agents.slice();
  const cmp = {
    cpu: (a, b) => (b.cpu || 0) - (a.cpu || 0),
    mem: (a, b) => (b.rssKb || 0) - (a.rssKb || 0),
    runtime: (a, b) => agentRuntimeMs(b, now) - agentRuntimeMs(a, now),
    tool: (a, b) => String(a.toolName || '').localeCompare(String(b.toolName || '')),
    status: (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
    name: (a, b) => sessionName(a).localeCompare(sessionName(b)),
  }[sortKey] || (() => 0);

  return list.sort((a, b) => {
    const primary = cmp(a, b);
    if (primary !== 0) {
      return primary;
    }
    return (b.cpu || 0) - (a.cpu || 0) || String(a.id).localeCompare(String(b.id));
  });
}

function filterAgents(agents, filterText) {
  const needle = String(filterText || '').trim().toLowerCase();
  if (!needle) {
    return agents;
  }
  return agents.filter((agent) => {
    const haystack = [
      agent.toolName,
      agent.toolKey,
      agent.sessionName,
      agent.title,
      agent.projectLabel,
      agent.projectPath,
      agent.currentTask,
      agent.activity,
      agent.status,
      agent.toolCall?.summary,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

function renderDashboard({
  agents = [],
  width = 80,
  height = 24,
  now = Date.now(),
  selectedId,
  sortKey = 'cpu',
  filter = '',
  totals,
  cpuHistory = [],
  paused = false,
} = {}) {
  const W = Math.max(40, Math.floor(width || 80));
  const H = Math.max(8, Math.floor(height || 24));
  const grid = makeGrid(W, H);

  const sums = totals || computeTotals(agents);
  drawTitle(grid, W, sums, cpuHistory, paused);

  const columns = planColumns(W);
  drawHeader(grid, 1, columns, sortKey);

  const showDetail = H >= 16;
  const detailHeight = showDetail ? 6 : 0;
  const footerY = H - 1;
  const rowsTop = 2;
  const rowsBottom = footerY - detailHeight;
  const visibleRows = Math.max(0, rowsBottom - rowsTop);

  const selectedIndex = Math.max(0, agents.findIndex((agent) => agent.id === selectedId));
  const first = Math.max(0, Math.min(selectedIndex - Math.floor(visibleRows / 2), Math.max(0, agents.length - visibleRows)));

  if (agents.length === 0) {
    const message = filter ? `No agents match "${filter}".` : 'No agents detected yet — scanning…';
    drawText(grid, 2, rowsTop + 1, message, 'gray');
  }

  for (let row = 0; row < visibleRows && first + row < agents.length; row += 1) {
    const agent = agents[first + row];
    const y = rowsTop + row;
    const selected = first + row === selectedIndex;
    drawRow(grid, y, columns, agent, now, selected);
  }

  const hidden = agents.length - visibleRows;
  if (hidden > 0 && visibleRows > 0) {
    drawText(grid, W - 12, rowsBottom - 1, `+${hidden} more`, 'yellow');
  }

  if (showDetail) {
    drawDetail(grid, rowsBottom, W, agents[selectedIndex], now);
  }

  drawFooter(grid, footerY, W, sortKey, filter, agents.length);
  return gridToBlessed(grid);
}

function computeTotals(agents) {
  let working = 0;
  let idle = 0;
  let cpu = 0;
  let rssKb = 0;
  for (const agent of agents) {
    if (agent.status === 'idle') idle += 1;
    else if (agent.status !== 'stopped') working += 1;
    if (Number.isFinite(agent.cpu)) cpu += agent.cpu;
    if (Number.isFinite(agent.rssKb)) rssKb += agent.rssKb;
  }
  return { agents: agents.length, working, idle, cpu: Math.round(cpu * 10) / 10, rssKb };
}

function drawTitle(grid, width, totals, cpuHistory, paused) {
  fillRow(grid, 0, ' ', 'gray');
  drawText(grid, 0, 0, '▍', 'cyan');
  drawText(grid, 1, 0, 'ai-office', 'white');
  drawText(grid, 11, 0, '· dashboard', 'gray');
  const spark = sparkline(cpuHistory, { width: 16 });
  const summary = [
    `${totals.agents} agents`,
    `${totals.working} working`,
    `${totals.idle} idle`,
    `cpu ${formatPercent(totals.cpu)}`,
    `mem ${formatMemoryKb(totals.rssKb)}`,
  ].join('  ·  ');
  let x = 26;
  x = drawText(grid, x, 0, summary, 'white');
  if (spark) {
    drawText(grid, x + 2, 0, spark, 'green');
  }
  if (paused) {
    drawText(grid, width - 8, 0, 'PAUSED', 'yellow');
  }
}

function planColumns(width) {
  let active = COLUMNS.slice();
  const minWidth = (col) => (col.flex ? col.min : col.width);
  const totalMin = () => active.reduce((sum, col) => sum + minWidth(col), 0) + (active.length - 1);

  while (totalMin() > width && active.some((col) => col.optional)) {
    const victim = active
      .filter((col) => col.optional)
      .sort((a, b) => a.drop - b.drop)[0];
    active = active.filter((col) => col !== victim);
  }

  const widths = {};
  for (const col of active) {
    widths[col.key] = minWidth(col);
  }

  let leftover = width - totalMin();
  const flexes = active.filter((col) => col.flex);
  const totalWeight = flexes.reduce((sum, col) => sum + col.weight, 0) || 1;
  if (leftover > 0 && flexes.length) {
    flexes.forEach((col, index) => {
      const share = index === flexes.length - 1
        ? leftover
        : Math.floor((width - totalMin()) * col.weight / totalWeight);
      widths[col.key] += share;
      leftover -= share;
    });
  }

  let x = 0;
  return active.map((col) => {
    const placed = { ...col, x, w: widths[col.key] };
    x += widths[col.key] + 1;
    return placed;
  });
}

function drawHeader(grid, y, columns, sortKey) {
  fillRow(grid, y, ' ', 'gray');
  for (const col of columns) {
    if (!col.label) {
      continue;
    }
    const sorted = col.key === sortKey || (sortKey === 'mem' && col.key === 'mem') || (sortKey === 'runtime' && col.key === 'run');
    const label = sorted ? `${col.label}▾` : col.label;
    drawAligned(grid, col, y, label, sorted ? 'cyan' : 'gray');
  }
}

function drawRow(grid, y, columns, agent, now, selected) {
  if (selected) {
    fillRow(grid, y, ' ', 'white', 'blue');
  }
  for (const col of columns) {
    if (col.key === 'marker') {
      drawAligned(grid, col, y, selected ? '›' : ' ', 'cyan', selected ? 'blue' : undefined, selected);
      continue;
    }
    const { text, color } = cellFor(col.key, agent, now);
    drawAligned(grid, col, y, text, selected ? 'white' : color, selected ? 'blue' : undefined, selected);
  }
}

function cellFor(key, agent, now) {
  switch (key) {
    case 'marker':
      return { text: ' ', color: 'cyan' };
    case 'status':
      return { text: `● ${statusWord(agent)}`, color: STATUS_COLOR[agent.status] || 'white' };
    case 'tool':
      return { text: toolLabel(agent), color: agent.color || 'white' };
    case 'name':
      return { text: identityName(agent), color: 'white' };
    case 'cpu':
      return { text: formatPercent(agent.cpu), color: cpuColor(agent.cpu) };
    case 'mem':
      return { text: formatMemoryKb(agent.rssKb), color: 'white' };
    case 'run':
      return { text: formatDuration(agentRuntimeMs(agent, now)), color: 'gray' };
    case 'pid':
      return { text: String(agent.pid ?? '-'), color: 'gray' };
    case 'project':
      return { text: agent.projectLabel || agent.projectPath || '-', color: 'gray' };
    case 'task':
      return { text: taskText(agent), color: 'white' };
    default:
      return { text: '', color: 'white' };
  }
}

function statusWord(agent) {
  if (agent.status === 'stopped') return 'done';
  if (agent.status === 'starting') return 'start';
  if (agent.status === 'idle') return 'idle';
  if (agent.status === 'unknown') return '?';
  return 'work';
}

function cpuColor(cpu) {
  const value = Number(cpu);
  if (!Number.isFinite(value) || value <= 0) return 'gray';
  if (value >= 80) return 'red';
  if (value >= 40) return 'yellow';
  return 'green';
}

function toolLabel(agent) {
  const key = String(agent.toolKey || agent.toolName || '').toLowerCase();
  if (key.includes('codex')) return agent.surface === 'desktop' ? 'CodexApp' : 'Codex';
  if (key.includes('claude') && key.includes('desktop')) return 'ClaudeApp';
  if (key.includes('claude')) return 'Claude';
  if (key.includes('cursor')) return 'Cursor';
  if (key.includes('aider')) return 'Aider';
  if (key.includes('gemini')) return 'Gemini';
  if (key.includes('goose')) return 'Goose';
  if (key.includes('opencode')) return 'OpenCode';
  return String(agent.toolName || agent.toolKey || 'AI');
}

function sessionName(agent) {
  return String(agent.title || agent.sessionName || agent.projectLabel || agent.projectPath || agent.toolName || 'session');
}

// Stable session identity (terminal tab title / project / session name), as
// distinct from the live task shown in the TASK column.
function identityName(agent) {
  const project = agent.projectLabel || agent.projectPath;
  const base = project ? String(project).split(/[\\/]/).filter(Boolean).pop() : '';
  return String(agent.terminalTitle || base || agent.sessionName || agent.toolName || 'session');
}

function taskText(agent) {
  if (agent.toolCall?.summary) {
    return agent.toolCall.summary;
  }
  return String(agent.currentTask || agent.activity || agent.title || '-');
}

function drawDetail(grid, y, width, agent, now) {
  for (let x = 0; x < width; x += 1) {
    grid[y][x] = cell('─', 'gray');
  }
  drawText(grid, 2, y, ' details ', 'gray');
  if (!agent) {
    drawText(grid, 2, y + 1, 'Select an agent to inspect it.', 'gray');
    return;
  }
  const inner = width - 2;
  const line1 = [
    `${toolLabel(agent)}`,
    sessionName(agent),
    `pid ${agent.pid}${agent.pids && agent.pids.length > 1 ? `+${agent.pids.length - 1}` : ''}`,
    agent.tty ? `tty ${agent.tty}` : '',
    agent.modelName ? `model ${agent.modelName}` : '',
    `cpu ${formatPercent(agent.cpu)}`,
    `mem ${formatMemoryKb(agent.rssKb)}`,
    `up ${formatDuration(agentRuntimeMs(agent, now))}`,
  ].filter(Boolean).join('  ·  ');
  drawText(grid, 2, y + 1, truncate(line1, inner), 'white');
  drawText(grid, 2, y + 2, truncate(`task: ${taskText(agent)}`, inner), 'white');
  if (agent.projectPath || agent.projectLabel) {
    drawText(grid, 2, y + 3, truncate(`path: ${agent.projectLabel || agent.projectPath}`, inner), 'gray');
  }
  const spark = sparkline(agent.cpuHistory || [], { width: Math.min(40, inner - 12) });
  if (spark) {
    drawText(grid, 2, y + 4, `cpu: ${spark}`, 'green');
  }
  drawText(grid, 2, y + 5, truncate(`cmd: ${agent.command || '-'}`, inner), 'gray');
}

function drawFooter(grid, y, width, sortKey, filter, count) {
  fillRow(grid, y, ' ', 'gray');
  const keys = 'q quit  ↑↓ select  s sort  / filter  k signal  c cd-hint  o office  r rescan';
  drawText(grid, 0, y, keys, 'gray', undefined, false, width);
  const right = filter
    ? `sort:${sortKey}  filter:"${filter}"  (${count})`
    : `sort:${sortKey}  (${count})`;
  drawText(grid, Math.max(0, width - right.length - 1), y, right, 'white');
}

// ---- grid primitives (fg + bg + bold cells) ----

function makeGrid(width, height) {
  return Array.from({ length: height }, () => (
    Array.from({ length: width }, () => cell(' ', undefined))
  ));
}

function cell(ch, color, bg, bold = false) {
  return { ch, color, bg, bold };
}

function drawAligned(grid, col, y, text, color, bg, bold = false) {
  const value = String(text == null ? '' : text);
  const fitted = truncate(value, col.w);
  const startX = col.align === 'right' ? col.x + (col.w - fitted.length) : col.x;
  drawText(grid, startX, y, fitted, color, bg, bold, col.x + col.w);
}

function drawText(grid, x, y, text, color, bg, bold = false, maxX) {
  if (y < 0 || y >= grid.length) {
    return x;
  }
  const row = grid[y];
  const limit = Number.isFinite(maxX) ? Math.min(row.length, maxX) : row.length;
  const value = String(text == null ? '' : text);
  let col = x;
  for (let index = 0; index < value.length; index += 1) {
    col = x + index;
    if (col < 0 || col >= limit) {
      continue;
    }
    row[col] = cell(value[index], color, bg, bold);
  }
  return col + 1;
}

function fillRow(grid, y, ch, color, bg) {
  if (y < 0 || y >= grid.length) {
    return;
  }
  for (let x = 0; x < grid[y].length; x += 1) {
    grid[y][x] = cell(ch, color, bg);
  }
}

function gridToBlessed(grid) {
  return grid.map((row) => {
    let output = '';
    let activeColor;
    let activeBg;
    let activeBold = false;
    for (const item of row) {
      if (item.color !== activeColor || item.bg !== activeBg || item.bold !== activeBold) {
        if (activeColor || activeBg || activeBold) {
          output += '{/}';
        }
        activeColor = item.color;
        activeBg = item.bg;
        activeBold = item.bold;
        if (activeColor) output += `{${activeColor}-fg}`;
        if (activeBg) output += `{${activeBg}-bg}`;
        if (activeBold) output += '{bold}';
      }
      output += escapeTag(item.ch);
    }
    if (activeColor || activeBg || activeBold) {
      output += '{/}';
    }
    return output;
  }).join('\n');
}

function escapeTag(value) {
  return String(value).replace(/[{}]/g, '');
}

module.exports = {
  SORT_KEYS,
  filterAgents,
  renderDashboard,
  sortAgents,
};
