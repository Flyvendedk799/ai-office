const { formatMemoryKb, formatPercent } = require('../util/format');

const MAP = [
  '########################################################################',
  '#......................................................................#',
  '#......................................................................#',
  '#..❀....▬▬▬▬▬▬▬▬▬▬......▬▬▬▬▬▬▬▬▬▬......▬▬▬▬▬▬▬▬▬▬......▬▬▬▬▬▬▬▬▬▬.....#',
  '#......................................................................#',
  '#.......n........n......n........n......n........n......n........n.....#',
  '#......................................................................#',
  '#......................................................................#',
  '#......................................................................#',
  '#..❀....▬▬▬▬▬▬▬▬▬▬......▬▬▬▬▬▬▬▬▬▬......▬▬▬▬▬▬▬▬▬▬......▬▬▬▬▬▬▬▬▬▬.....#',
  '#......................................................................#',
  '#.......n........n......n........n......n........n......n........n.....#',
  '#......................................................................#',
  '+......................................................................#',
  '+.............................................┌──── break ─────┐.......#',
  '#..❀....▬▬▬▬▬▬▬▬▬▬............................│...............│........#',
  '#..............................................│..▣▣▣▣.....~~~.│.......#',
  '#.......n........n............................│...............│........#',
  '#..............................................└───────────────┘.......#',
  '#......................................................................#',
  '#......................................................................#',
  '########################################################################',
].map((line) => Array.from(line));

const MAP_W = MAP[0].length;
const MAP_H = MAP.length;
const STEP_MS = 120;
const ENTRANCE = { x: 1, y: 13 };

const COLORS = {
  codex: 'yellow',
  claude: 'red',
  cursor: 'cyan',
  ai: 'magenta',
  wall: 'gray',
  desk: 'yellow',
  chair: 'red',
  coffee: 'yellow',
  couch: 'magenta',
  plant: 'green',
  frame: 'gray',
  muted: 'gray',
  fg: 'white',
  selected: 'blue',
};

const VENDOR_TAG = {
  codex: 'cdx',
  claude: 'cla',
  cursor: 'cur',
  ai: 'ai',
};

const SEATS = [];
for (let y = 0; y < MAP_H; y += 1) {
  for (let x = 0; x < MAP_W; x += 1) {
    if (MAP[y][x] === 'n') {
      SEATS.push({ x, y });
    }
  }
}

const COFFEE_AT = findFirst('▣');
const COUCH_AT = findFirst('~');
const COFFEE = { x: COFFEE_AT.x + 1, y: COFFEE_AT.y + 1 };
const COUCH = { x: COUCH_AT.x + 1, y: COUCH_AT.y + 1 };
const COFFEE_SPOTS = [
  COFFEE,
  { x: COFFEE.x + 7, y: COFFEE.y },
  { x: COFFEE.x + 11, y: COFFEE.y },
];
const COUCH_SPOTS = [
  COUCH,
  { x: COUCH.x - 4, y: COUCH.y },
  { x: COUCH.x - 8, y: COUCH.y },
];
const ROUTE_CACHE = new Map();

function renderDesignOffice({ agents = [], width = 80, height = 24, now = Date.now(), selectedId, paused = false, filter = '' }) {
  const screenWidth = Math.max(40, Math.floor(width || 80));
  const screenHeight = Math.max(8, Math.floor(height || 24));
  const rows = makeGrid(screenWidth, screenHeight);
  const sessions = agents.map((agent, index) => toSession(agent, index, now));
  const selectedIndex = Math.max(0, sessions.findIndex((session) => session.id === selectedId));
  const focused = sessions[selectedIndex] || sessions[0];
  const visible = sessions.slice(0, SEATS.length);
  const focusedVisibleIndex = Math.max(0, visible.findIndex((session) => session.id === focused?.id));
  const designAgents = visible.map((session, index) => toDesignAgent(session, index, now));
  const map = renderMap(designAgents, focusedVisibleIndex, now);
  const mapLeft = Math.max(0, Math.floor((screenWidth - MAP_W) / 2));

  drawTitle(rows, sessions, paused, now, filter);
  pasteMap(rows, map, mapLeft, 1);
  drawSessionList(rows, sessions, selectedIndex, 1 + MAP_H, screenHeight - 2);
  drawStatus(rows, sessions, screenHeight - 1);

  return gridToBlessed(rows);
}

function toSession(agent, index, now) {
  const vendor = inferVendor(agent);
  const surface = inferSurface(agent);
  const name = shortHandle(agent, index);
  const task = sessionTask(agent);
  const activity = sessionActivity(agent);
  const appearedAt = agent.appearAt ?? agent.startedAt ?? now - 10000;
  const statusChangedAt = agent.statusChangedAt ?? appearedAt;
  return {
    id: String(agent.id ?? agent.pid ?? index),
    index,
    source: agent,
    vendor,
    surface,
    color: COLORS[vendor],
    name,
    task,
    title: agent.title || agent.sessionName,
    activity,
    toolCall: agent.toolCall,
    tag: `${VENDOR_TAG[vendor]}·${surface[0]}`,
    status: agent.status || agent.statusHint || 'active',
    previousStatus: agent.previousStatus || agent.statusBeforeStop,
    appearedAt,
    statusChangedAt,
    stoppedAt: agent.stoppedAt,
    cpu: agent.cpu,
    rssKb: agent.rssKb,
  };
}

function toDesignAgent(session, index, now) {
  const seatIndex = index % SEATS.length;
  const seat = SEATS[seatIndex];
  const visual = visualState(session, seat, now, index);
  return {
    ...session,
    idNumber: index,
    seat: seatIndex,
    x: visual.x,
    y: visual.y,
    dir: visual.dir,
    state: visual.state,
  };
}

function visualState(session, seat, now, index) {
  const age = Math.max(0, now - session.appearedAt);
  const statusAge = Math.max(0, now - session.statusChangedAt);
  const dir = index % 2 === 0 ? 1 : -1;

  if (session.status === 'stopped') {
    return onRoute(seat, ENTRANCE, Math.max(0, now - (session.stoppedAt || session.statusChangedAt)), 'walk', dir);
  }

  const enterRoute = route(ENTRANCE, seat);
  const enterDuration = Math.max(900, enterRoute.length * STEP_MS);
  if (session.status === 'starting' || age < enterDuration) {
    return onRoute(ENTRANCE, seat, age, 'walk', dir);
  }

  if (session.status === 'idle') {
    const coffee = breakSpot(COFFEE_SPOTS, session.index);
    const couch = breakSpot(COUCH_SPOTS, session.index);
    const toCoffee = route(seat, coffee);
    const toCoffeeDuration = toCoffee.length * STEP_MS;
    if (statusAge < toCoffeeDuration) {
      return onRoute(seat, coffee, statusAge, 'walk', dir);
    }
    const phase = (statusAge - toCoffeeDuration + index * 500) % 7600;
    if (phase < 1500) {
      return { ...coffee, state: 'coffee', dir };
    }
    if (phase < 2800) {
      return { ...coffee, state: 'sip', dir };
    }
    const coffeeToCouch = route(coffee, couch);
    const couchWalkDuration = coffeeToCouch.length * STEP_MS;
    if (phase < 2800 + couchWalkDuration) {
      return onRoute(coffee, couch, phase - 2800, 'walk', dir);
    }
    if (phase < 6200) {
      return { ...couch, state: 'couch', dir };
    }
    return onRoute(couch, seat, phase - 6200, 'walk', dir);
  }

  const returnCoffee = breakSpot(COFFEE_SPOTS, session.index);
  if (session.previousStatus === 'idle' && statusAge < route(returnCoffee, seat).length * STEP_MS) {
    return onRoute(returnCoffee, seat, statusAge, 'walk', dir);
  }

  const workPhase = (now - session.appearedAt + index * 900) % 8800;
  return {
    ...seat,
    state: workPhase > 6100 && workPhase < 7350 ? 'think' : 'type',
    dir,
  };
}

function onRoute(from, to, elapsedMs, state, fallbackDir) {
  const path = route(from, to);
  if (!path.length) {
    return { ...to, state, dir: fallbackDir };
  }
  const step = Math.min(path.length - 1, Math.floor(elapsedMs / STEP_MS));
  const point = path[step] || to;
  const previous = step > 0 ? path[step - 1] : from;
  const next = path[Math.min(path.length - 1, step + 1)] || point;
  const dx = next.x - previous.x;
  return {
    x: point.x,
    y: point.y,
    state,
    dir: dx > 0 ? 1 : dx < 0 ? -1 : fallbackDir,
  };
}

function breakSpot(spots, index) {
  for (let offset = 0; offset < spots.length; offset += 1) {
    const spot = spots[(index + offset) % spots.length];
    if (isFloor(spot.x, spot.y)) {
      return spot;
    }
  }
  return spots[0];
}

function renderMap(agents, focusIndex, now) {
  const tick = Math.floor(now / 100);
  const grid = MAP.map((row) => row.map(paintMapCell));

  for (const agent of agents) {
    drawAgent(grid, agent, tick);
  }

  const characterReserved = new Set();
  for (const agent of agents) {
    characterReserved.add(key(agent.x, agent.y));
    characterReserved.add(key(agent.x, agent.y + 1));
    if (agent.state === 'coffee' || agent.state === 'sip') {
      characterReserved.add(key(agent.x + agent.dir, agent.y));
    }
  }

  const focused = agents[focusIndex] || agents[0];
  const labelReserved = new Set(characterReserved);
  const focusedNeedsMini = focused && !bubbleHasRoom(focused);
  if (focusedNeedsMini) {
    const placed = drawMiniLabel(grid, labelReserved, focused);
    if (!placed) {
      drawInitialLabel(grid, labelReserved, focused);
    }
  }
  const ordered = agents.slice().sort((a, b) => {
    if (focused && a.id === focused.id) return -1;
    if (focused && b.id === focused.id) return 1;
    const aStable = a.state === 'type' || a.state === 'think' ? 1 : 0;
    const bStable = b.state === 'type' || b.state === 'think' ? 1 : 0;
    if (aStable !== bStable) return bStable - aStable;
    return a.idNumber - b.idNumber;
  });

  for (const agent of ordered) {
    if (focused && agent.id === focused.id) {
      continue;
    }
    const placed = drawMiniLabel(grid, labelReserved, agent);
    if (!placed) {
      drawInitialLabel(grid, labelReserved, agent);
    }
  }

  if (focused && !focusedNeedsMini) {
    const bubbleDrawn = drawBubble(grid, characterReserved, focused);
    if (!bubbleDrawn) {
      const placed = drawMiniLabel(grid, labelReserved, focused);
      if (!placed) {
        drawInitialLabel(grid, labelReserved, focused);
      }
    }
  }

  return grid;
}

function bubbleHasRoom(agent) {
  const header = truncatePlain(`${agent.name} · ${agent.tag}`, MAP_W - 8);
  const task = truncatePlain(agent.task, MAP_W - 8);
  const innerWidth = Math.max(header.length, task.length) + 2;
  const totalWidth = Math.min(MAP_W - 2, innerWidth + 2);
  const top = agent.y - 4;
  const middle = agent.y - 3;
  const bottom = agent.y - 2;
  if (top < 1) {
    return false;
  }
  const start = clamp(agent.x - Math.floor(totalWidth / 2), 1, MAP_W - 1 - totalWidth);
  for (const y of [top, middle, bottom]) {
    for (let offset = 0; offset < totalWidth; offset += 1) {
      if (!isFloor(start + offset, y)) {
        return false;
      }
    }
  }
  return true;
}

function drawAgent(grid, agent, tick) {
  const hat = agent.surface === 'desktop' ? '▔' : '˙';
  if (isFloor(agent.x, agent.y - 1)) {
    setCell(grid, agent.x, agent.y - 1, hat, agent.color);
  }
  setCell(grid, agent.x, agent.y, 'o', agent.color, true);
  if (isWalk(agent.x, agent.y + 1)) {
    setCell(grid, agent.x, agent.y + 1, bodyChar(agent, tick), agent.color);
  }
  if (agent.state === 'coffee' || agent.state === 'sip') {
    const cupX = agent.x + agent.dir;
    if (isFloor(cupX, agent.y)) {
      setCell(grid, cupX, agent.y, 'u', COLORS.coffee);
    }
  }
  if (agent.state === 'think' && isFloor(agent.x, agent.y - 2)) {
    setCell(grid, agent.x, agent.y - 2, tick % 30 < 15 ? '·' : '˙', COLORS.muted);
  }
}

function bodyChar(agent, tick) {
  if (agent.state === 'walk') {
    return tick % 10 < 5 ? '/' : '\\';
  }
  if (agent.state === 'couch') {
    return '_';
  }
  if (agent.state === 'type') {
    return tick % 14 < 7 ? 'T' : 'Y';
  }
  return 'Y';
}

function drawMiniLabel(grid, reserved, agent) {
  const text = labelText(agent);
  const y = agent.y - 1;
  const start = clamp(agent.x - Math.floor(text.length / 2), 1, MAP_W - 1 - text.length);
  if ((start > 1 && !canPaintLabel(reserved, start - 1, y)) || (start + text.length < MAP_W - 1 && !canPaintLabel(reserved, start + text.length, y))) {
    return false;
  }
  for (let index = 0; index < text.length; index += 1) {
    if (!canPaintLabel(reserved, start + index, y)) {
      return false;
    }
  }
  const breakIndex = Math.max(text.indexOf('·'), text.indexOf(' '));
  for (let index = 0; index < text.length; index += 1) {
    const color = breakIndex >= 0 && index > breakIndex ? COLORS.muted : agent.color;
    setCell(grid, start + index, y, text[index], color);
    reserved.add(key(start + index, y));
  }
  if (start > 1 && isFloor(start - 1, y)) {
    reserved.add(key(start - 1, y));
  }
  if (start + text.length < MAP_W - 1 && isFloor(start + text.length, y)) {
    reserved.add(key(start + text.length, y));
  }
  return true;
}

function drawInitialLabel(grid, reserved, agent) {
  const y = agent.y - 1;
  if (!canPaintLabel(reserved, agent.x, y)) {
    return;
  }
  setCell(grid, agent.x, y, agent.name[0] || '?', agent.color);
  reserved.add(key(agent.x, y));
}

function drawBubble(grid, reserved, agent) {
  const header = truncatePlain(`${agent.name} · ${agent.tag}`, MAP_W - 8);
  const task = truncatePlain(agent.task, MAP_W - 8);
  const innerWidth = Math.max(header.length, task.length) + 2;
  const totalWidth = Math.min(MAP_W - 2, innerWidth + 2);
  const top = agent.y - 4;
  const middle = agent.y - 3;
  const bottom = agent.y - 2;
  const tailY = agent.y - 1;
  if (top < 1) {
    return false;
  }

  let start = agent.x - Math.floor(totalWidth / 2);
  start = clamp(start, 1, MAP_W - 1 - totalWidth);
  for (const y of [top, middle, bottom]) {
    for (let offset = 0; offset < totalWidth; offset += 1) {
      const x = start + offset;
      if (!isFloor(x, y) || reserved.has(key(x, y))) {
        return false;
      }
    }
  }

  const tailX = clamp(agent.x, start + 1, start + totalWidth - 2);
  setCell(grid, start, top, '┌', COLORS.frame);
  setCell(grid, start + totalWidth - 1, top, '┐', COLORS.frame);
  for (let x = start + 1; x < start + totalWidth - 1; x += 1) {
    setCell(grid, x, top, '─', COLORS.frame);
  }
  drawBubbleText(grid, start + 2, top, header, agent.name.length, agent.color, totalWidth - 4);

  setCell(grid, start, middle, '│', COLORS.frame);
  setCell(grid, start + totalWidth - 1, middle, '│', COLORS.frame);
  drawTextCells(grid, start + 2, middle, truncatePlain(task, totalWidth - 4), COLORS.fg, totalWidth - 4);

  for (let x = start; x < start + totalWidth; x += 1) {
    let ch = '─';
    if (x === start) ch = '└';
    if (x === start + totalWidth - 1) ch = '┘';
    if (x === tailX) ch = '┬';
    setCell(grid, x, bottom, ch, COLORS.frame);
  }
  if (isFloor(tailX, tailY)) {
    setCell(grid, tailX, tailY, '│', COLORS.frame);
  }
  return true;
}

function drawBubbleText(grid, x, y, text, nameLength, nameColor, maxWidth) {
  const fitted = truncatePlain(text, maxWidth);
  for (let index = 0; index < fitted.length; index += 1) {
    setCell(grid, x + index, y, fitted[index], index < nameLength ? nameColor : COLORS.muted);
  }
}

function drawTitle(rows, sessions, paused, now, filter = '') {
  const width = rows[0].length;
  const scanning = sessions.length === 0 && !filter;
  const dots = '.'.repeat(Math.floor(now / 300) % 4);
  fillRow(rows, 0, ' ', COLORS.frame);
  drawTextCells(rows, 0, 0, '┌ agent-office │ ', COLORS.frame);
  drawTextCells(rows, 17, 0, cwdLabel(sessions), COLORS.fg, 12);
  drawTextCells(rows, 29, 0, ' │ ', COLORS.frame);
  if (scanning) {
    drawTextCells(rows, 32, 0, `scanning host${dots}`, COLORS.claude, Math.max(0, width - 42));
  } else {
    const base = `${sessions.length} sessions`;
    const status = filter ? `filter "${filter}" · ${base}` : `scan complete · ${base} · codex · claude · cursor`;
    drawTextCells(rows, 32, 0, paused ? `paused · ${status}` : status, filter ? COLORS.cursor : COLORS.muted, Math.max(0, width - 42));
  }
  if (width > 10) {
    drawTextCells(rows, width - 8, 0, '72×22 ┐', COLORS.frame);
  }
}

function drawSessionList(rows, sessions, selectedIndex, startY, endY) {
  if (startY >= endY || startY >= rows.length - 1) {
    return;
  }
  const maxRows = Math.max(0, endY - startY);
  if (maxRows <= 0) {
    return;
  }
  drawTextCells(rows, 0, startY, 'sessions', COLORS.muted, rows[0].length);
  const visibleRows = Math.max(0, maxRows - 1);
  const listStart = startY + 1;
  const first = Math.max(0, Math.min(selectedIndex - Math.floor(visibleRows / 2), Math.max(0, sessions.length - visibleRows)));
  for (let row = 0; row < visibleRows && first + row < sessions.length; row += 1) {
    const session = sessions[first + row];
    const y = listStart + row;
    const selected = first + row === selectedIndex;
    if (selected) {
      fillRow(rows, y, ' ', COLORS.fg);
    }
    drawSessionRow(rows, y, session, selected);
  }
  const hidden = sessions.length - visibleRows;
  if (hidden > 0 && visibleRows > 0) {
    drawTextCells(rows, rows[0].length - 10, listStart + visibleRows - 1, `+${hidden}`, COLORS.muted, 9);
  }
}

function drawSessionRow(rows, y, session, selected) {
  const color = session.color;
  const width = rows[0].length;
  const showCpu = width >= 60 && Number.isFinite(session.cpu);
  const cpuText = showCpu ? formatPercent(session.cpu) : '';
  const taskWidth = Math.max(0, width - 40 - (showCpu ? 7 : 0));
  drawTextCells(rows, 0, y, selected ? '›' : ' ', COLORS.muted);
  drawTextCells(rows, 2, y, '●', color);
  drawTextCells(rows, 4, y, session.name.padEnd(8, ' '), COLORS.fg, 9);
  drawTextCells(rows, 14, y, `[${session.tag}]`, color, 8);
  drawTextCells(rows, 24, y, activityLabel(session).padEnd(13, ' '), COLORS.muted, 14);
  drawTextCells(rows, 39, y, truncatePlain(session.task, taskWidth), COLORS.fg, taskWidth);
  if (showCpu) {
    drawTextCells(rows, width - cpuText.length - 1, y, cpuText, cpuColor(session.cpu), 6);
  }
}

function cpuColor(cpu) {
  const value = Number(cpu);
  if (!Number.isFinite(value) || value <= 0) return COLORS.muted;
  if (value >= 80) return 'red';
  if (value >= 40) return 'yellow';
  return 'green';
}

function drawStatus(rows, sessions, y) {
  const working = sessions.filter((session) => ['active', 'starting'].includes(session.status)).length;
  const onBreak = Math.max(0, sessions.length - working);
  let cpu = 0;
  let rssKb = 0;
  let hasMetrics = false;
  for (const session of sessions) {
    if (Number.isFinite(session.cpu)) { cpu += session.cpu; hasMetrics = true; }
    if (Number.isFinite(session.rssKb)) { rssKb += session.rssKb; hasMetrics = true; }
  }
  fillRow(rows, y, ' ', COLORS.muted);
  drawTextCells(rows, 0, y, 'q quit  r rescan  d dashboard  / filter  k signal  p pause  h help', COLORS.muted, rows[0].length);
  const summaryParts = [`${working} working`, `${onBreak} break`];
  if (hasMetrics) {
    summaryParts.push(`cpu ${formatPercent(cpu)}`, `mem ${formatMemoryKb(rssKb)}`);
  }
  const summary = summaryParts.join(' · ');
  drawTextCells(rows, Math.max(0, rows[0].length - summary.length - 1), y, summary, COLORS.fg);
}

function pasteMap(rows, map, left, top) {
  for (let y = 0; y < map.length; y += 1) {
    const targetY = top + y;
    if (targetY < 0 || targetY >= rows.length - 1) {
      continue;
    }
    for (let x = 0; x < map[y].length; x += 1) {
      const targetX = left + x;
      if (targetX < 0 || targetX >= rows[targetY].length) {
        continue;
      }
      rows[targetY][targetX] = map[y][x];
    }
  }
}

function paintMapCell(ch) {
  if (ch === '#') return cell('▓', COLORS.wall);
  if (ch === '+') return cell(' ', undefined);
  if (ch === '▬') return cell('▬', COLORS.desk);
  if (ch === 'n') return cell('n', COLORS.chair);
  if (ch === '▣') return cell('▣', COLORS.coffee);
  if (ch === '~') return cell('~', COLORS.couch);
  if (ch === '❀') return cell('❀', COLORS.plant);
  if (ch === '.') return cell(' ', undefined);
  return cell(ch, COLORS.frame);
}

function route(from, to) {
  const cacheKey = `${from.x},${from.y}:${to.x},${to.y}`;
  if (ROUTE_CACHE.has(cacheKey)) {
    return ROUTE_CACHE.get(cacheKey);
  }
  const found = bfs(from.x, from.y, to.x, to.y);
  ROUTE_CACHE.set(cacheKey, found);
  return found;
}

function bfs(sx, sy, tx, ty) {
  const startKey = key(sx, sy);
  const targetKey = key(tx, ty);
  const previous = new Map();
  const seen = new Set([startKey]);
  const queue = [{ x: sx, y: sy }];
  while (queue.length > 0) {
    const point = queue.shift();
    if (key(point.x, point.y) === targetKey) {
      break;
    }
    for (const next of neighbors(point)) {
      if (!(isWalk(next.x, next.y) || key(next.x, next.y) === targetKey)) {
        continue;
      }
      const nextKey = key(next.x, next.y);
      if (seen.has(nextKey)) {
        continue;
      }
      seen.add(nextKey);
      previous.set(nextKey, key(point.x, point.y));
      queue.push(next);
    }
  }
  if (!previous.has(targetKey)) {
    return [{ x: sx, y: sy }, { x: tx, y: ty }];
  }
  const output = [];
  let current = targetKey;
  while (current !== startKey) {
    output.push(pointFromKey(current));
    current = previous.get(current);
  }
  output.push({ x: sx, y: sy });
  return output.reverse();
}

function neighbors(point) {
  return [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 },
  ];
}

function isWalk(x, y) {
  const ch = mapChar(x, y);
  return ch === '.' || ch === '+' || ch === 'n' || ch === ' ';
}

function isFloor(x, y) {
  const ch = mapChar(x, y);
  return ch === '.' || ch === '+';
}

function mapChar(x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) {
    return undefined;
  }
  return MAP[y][x];
}

function canPaintLabel(reserved, x, y) {
  if (x < 1 || y < 1 || x >= MAP_W - 1 || y >= MAP_H - 1) {
    return false;
  }
  return isFloor(x, y) && !reserved.has(key(x, y));
}

function labelText(agent) {
  if (agent.state === 'walk') {
    return `${agent.name} ${agent.dir > 0 ? '→' : '←'}`;
  }
  if (agent.toolCall?.shortName && (agent.state === 'type' || agent.state === 'think')) {
    return `${agent.name}·${truncatePlain(agent.toolCall.shortName, 3)}`;
  }
  return `${agent.name}·${verbOf(agent.state)}`;
}

function verbOf(state) {
  if (state === 'type') return 'typ';
  if (state === 'think') return 'thk';
  if (state === 'coffee') return 'cof';
  if (state === 'sip') return 'sip';
  if (state === 'couch') return 'zzz';
  return '→';
}

function activityLabel(session) {
  if (session.status === 'idle') return 'break';
  if (session.status === 'starting') return 'walking';
  if (session.status === 'stopped') return 'leaving';
  if (session.toolCall?.shortName) {
    return truncatePlain(`${session.toolCall.shortName}${session.toolCall.status === 'done' ? '✓' : ''}`, 13);
  }
  if (session.activity) {
    return truncatePlain(session.activity, 13);
  }
  return session.previousStatus === 'idle' ? 'returning' : 'typing';
}

function inferVendor(agent) {
  const key = String(`${agent.toolKey || ''} ${agent.toolName || ''}`).toLowerCase();
  if (key.includes('codex')) return 'codex';
  if (key.includes('claude')) return 'claude';
  if (key.includes('cursor')) return 'cursor';
  return 'ai';
}

function inferSurface(agent) {
  if (agent.surface === 'desktop' || agent.surface === 'terminal') {
    return agent.surface;
  }
  const key = String(`${agent.toolKey || ''} ${agent.toolName || ''} ${agent.processName || ''}`).toLowerCase();
  if (key.includes('desktop') || key.includes('cursor') || key.includes('.app')) {
    return 'desktop';
  }
  return 'terminal';
}

function shortHandle(agent, index) {
  const source = String(agent.terminalTitle || agent.sessionName || agent.projectLabel || agent.projectPath || agent.title || agent.toolName || `ai-${index + 1}`);
  const parts = source
    .replace(/^~?\/*(Users\/[^/]+\/)?/, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  const handle = (parts.find((part) => part.length >= 3) || parts[0] || `ai${index + 1}`).toLowerCase();
  return handle.slice(0, 6).padEnd(Math.min(4, handle.length), ' ');
}

function sessionTask(agent) {
  if (agent.toolCall?.summary && agent.currentTask) {
    return `${agent.toolCall.summary} · ${agent.currentTask}`;
  }
  return String(agent.currentTask || agent.title || agent.sessionName || agent.projectLabel || agent.projectPath || agent.command || agent.toolName || 'agent session');
}

function sessionActivity(agent) {
  if (agent.toolCall?.activity) {
    return agent.toolCall.activity;
  }
  return agent.activity || '';
}

function cwdLabel(sessions) {
  const project = sessions.find((session) => session.source.projectLabel || session.source.projectPath);
  const label = project?.source.projectLabel || project?.source.projectPath || '~/dev';
  return truncatePlain(label, 11).padEnd(11, ' ');
}

function drawTextCells(grid, x, y, text, color, maxWidth = String(text).length) {
  if (y < 0 || y >= grid.length || maxWidth <= 0) {
    return;
  }
  const fitted = truncatePlain(String(text), maxWidth);
  for (let index = 0; index < fitted.length; index += 1) {
    const col = x + index;
    if (col < 0 || col >= grid[y].length) {
      continue;
    }
    grid[y][col] = cell(fitted[index], color);
  }
}

function fillRow(grid, y, ch, color) {
  if (y < 0 || y >= grid.length) {
    return;
  }
  for (let x = 0; x < grid[y].length; x += 1) {
    grid[y][x] = cell(ch, color);
  }
}

function setCell(grid, x, y, ch, color, bold = false) {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[y].length) {
    return;
  }
  grid[y][x] = cell(ch, color, bold);
}

function cell(ch, color, bold = false) {
  return { ch, color, bold };
}

function makeGrid(width, height) {
  return Array.from({ length: height }, () => (
    Array.from({ length: width }, () => cell(' ', undefined))
  ));
}

function gridToBlessed(grid) {
  return grid.map((row) => {
    let output = '';
    let activeColor;
    let activeBold = false;
    for (const item of row) {
      if (item.color !== activeColor || item.bold !== activeBold) {
        if (activeColor || activeBold) {
          output += '{/}';
        }
        activeColor = item.color;
        activeBold = item.bold;
        if (activeColor) {
          output += `{${activeColor}-fg}`;
        }
        if (activeBold) {
          output += '{bold}';
        }
      }
      output += escapeTag(item.ch);
    }
    if (activeColor || activeBold) {
      output += '{/}';
    }
    return output;
  }).join('\n');
}

function findFirst(ch) {
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      if (MAP[y][x] === ch) {
        return { x, y };
      }
    }
  }
  return { x: 0, y: 0 };
}

function truncatePlain(value, maxLength) {
  const text = String(value || '');
  if (maxLength <= 0) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 1) {
    return text.slice(0, maxLength);
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function key(x, y) {
  return `${x},${y}`;
}

function pointFromKey(value) {
  const [x, y] = value.split(',').map(Number);
  return { x, y };
}

function escapeTag(value) {
  return String(value).replace(/[{}]/g, '');
}

module.exports = {
  MAP_H,
  MAP_W,
  SEATS,
  renderDesignOffice,
};
