const { formatMemoryKb, formatPercent } = require('../util/format');
const { UI, inferVendor, vendorColor } = require('./theme');

// ── The office ──────────────────────────────────────────────────────────────
// Fixed-art floor plan. Legend:
//   ║ ═ ╔ ╗ ╚ ╝ ╡ ╞ ┌ ┐ └ ┘ ─ │   walls (drawn as-is)
//   w  window (animated sky)        k  wall clock (live local time)
//   ▬  desk                         n  seat
//   ▣  coffee machine               ~  couch
//   ❀  plant                        .  floor
//   +  entrance door (walkable)
const MAP = [
  '╔═══╡ww╞═══════╡ww╞═══════╡ww╞═══════╡ww╞═══════╡ww╞═════╡kkkkk╞═════╗',
  '║....................................................................║',
  '║.❀...▬▬▬▬▬▬▬▬▬▬.....▬▬▬▬▬▬▬▬▬▬.....▬▬▬▬▬▬▬▬▬▬.....▬▬▬▬▬▬▬▬▬▬.....❀..║',
  '║....................................................................║',
  '║.......n....n.........n....n.........n....n.........n....n..........║',
  '║....................................................................║',
  '║.❀...▬▬▬▬▬▬▬▬▬▬.....▬▬▬▬▬▬▬▬▬▬.....▬▬▬▬▬▬▬▬▬▬.....▬▬▬▬▬▬▬▬▬▬........║',
  '║....................................................................║',
  '║.......n....n.........n....n.........n....n.........n....n..........║',
  '║....................................................................║',
  '║.❀...▬▬▬▬▬▬▬▬▬▬.....▬▬▬▬▬▬▬▬▬▬..........┌────────────────────────┐..║',
  '║........................................│........................│..║',
  '+.......n....n.........n....n............│...▣......~~~~......❀...│..║',
  '+.................................................................│..║',
  '║........................................└────────────────────────┘..║',
  '║....................................................................║',
  '╚════════════════════════════════════════════════════════════════════╝',
].map((line) => Array.from(line));

const MAP_W = MAP[0].length;
const MAP_H = MAP.length;
for (const row of MAP) {
  if (row.length !== MAP_W) {
    throw new Error(`office map is ragged: expected every row to be ${MAP_W} cells`);
  }
}

const STEP_MS = 120;
const ENTRANCE = { x: 1, y: 13 };

const SEATS = [];
const WINDOWS = [];
let CLOCK_AT = null;
for (let y = 0; y < MAP_H; y += 1) {
  for (let x = 0; x < MAP_W; x += 1) {
    const ch = MAP[y][x];
    if (ch === 'n') {
      SEATS.push({ x, y });
    }
    if (ch === 'w' && MAP[y][x - 1] !== 'w') {
      WINDOWS.push({ x, y });
    }
    if (ch === 'k' && !CLOCK_AT) {
      CLOCK_AT = { x, y };
    }
  }
}

const COFFEE = findFirst('▣');
const COFFEE_SPOTS = [
  { x: COFFEE.x - 1, y: COFFEE.y },
  { x: COFFEE.x + 1, y: COFFEE.y },
  { x: COFFEE.x + 2, y: COFFEE.y },
];
const COUCH = findFirst('~');
const COUCH_SPOTS = [
  { x: COUCH.x, y: COUCH.y + 1 },
  { x: COUCH.x + 2, y: COUCH.y + 1 },
  { x: COUCH.x + 3, y: COUCH.y + 1 },
];

const BREAK_ROOM = { x: findFirst('┌').x, y: findFirst('┌').y, w: 26 };
const ROOMBA_DOCK = { x: 3, y: MAP_H - 2 };
// The roomba patrols a rectangular circuit around the open floor, forever.
// If a future floor-plan edit blocks the circuit, it simply stays docked.
const ROOMBA_CIRCUIT = buildRoombaCircuit();
const ROUTE_CACHE = new Map();

function renderOffice({ agents = [], width = 80, height = 24, now = Date.now(), selectedId, paused = false, filter = '' }) {
  const screenWidth = Math.max(40, Math.floor(width || 80));
  const screenHeight = Math.max(8, Math.floor(height || 24));
  const rows = makeGrid(screenWidth, screenHeight);
  const sessions = agents.map((agent, index) => toSession(agent, index, now));
  const selectedIndex = Math.max(0, sessions.findIndex((session) => session.id === selectedId));
  const focused = sessions[selectedIndex] || sessions[0];
  const visible = sessions.slice(0, SEATS.length);
  const focusedVisibleIndex = Math.max(0, visible.findIndex((session) => session.id === focused?.id));
  const officeAgents = visible.map((session, index) => toOfficeAgent(session, index, now));
  const map = renderMap(officeAgents, focusedVisibleIndex, now);
  const mapLeft = Math.max(0, Math.floor((screenWidth - MAP_W) / 2));

  drawTitle(rows, sessions, paused, now, filter);
  pasteMap(rows, map, mapLeft, 1);
  if (sessions.length === 0) {
    drawEmptyHint(rows, mapLeft, filter);
  }
  drawSessionList(rows, sessions, selectedIndex, 1 + MAP_H, screenHeight - 2);
  drawStatus(rows, sessions, screenHeight - 1);

  return gridToBlessed(rows);
}

// ── Session model ───────────────────────────────────────────────────────────

function toSession(agent, index, now) {
  const vendor = inferVendor(agent);
  const surface = inferSurface(agent);
  const appearedAt = agent.appearAt ?? agent.startedAt ?? now - 10000;
  return {
    id: String(agent.id ?? agent.pid ?? index),
    index,
    source: agent,
    vendor,
    surface,
    color: vendorColor(vendor),
    name: shortHandle(agent, index),
    task: sessionTask(agent),
    title: agent.title || agent.sessionName,
    activity: agent.toolCall?.activity || agent.activity || '',
    toolCall: agent.toolCall,
    tag: `${vendor === 'ai' ? 'ai' : vendor.slice(0, 3)}·${surface[0]}`,
    status: agent.status || agent.statusHint || 'active',
    previousStatus: agent.previousStatus || agent.statusBeforeStop,
    appearedAt,
    statusChangedAt: agent.statusChangedAt ?? appearedAt,
    stoppedAt: agent.stoppedAt,
    cpu: agent.cpu,
    rssKb: agent.rssKb,
  };
}

function toOfficeAgent(session, index, now) {
  const seat = SEATS[index % SEATS.length];
  const visual = visualState(session, seat, now, index);
  return { ...session, idNumber: index, ...visual };
}

// Where an agent is and what it is doing, as a pure function of time — walking
// in, typing, thinking, wandering to the break room, or heading for the door.
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

// ── Map rendering ───────────────────────────────────────────────────────────

function renderMap(agents, focusIndex, now) {
  const tick = Math.floor(now / 100);
  const grid = MAP.map((row) => row.map((ch) => paintMapCell(ch)));

  drawRoomLabels(grid);
  drawSky(grid, now);
  drawClock(grid, now);
  drawCoffeeSteam(grid, now);
  drawRoomba(grid, now, agents);

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
  const ordered = agents.slice().sort((a, b) => {
    if (focused && a.id === focused.id) return -1;
    if (focused && b.id === focused.id) return 1;
    const aStable = a.state === 'type' || a.state === 'think' ? 1 : 0;
    const bStable = b.state === 'type' || b.state === 'think' ? 1 : 0;
    if (aStable !== bStable) return bStable - aStable;
    return a.idNumber - b.idNumber;
  });

  for (const agent of ordered) {
    if ((focused && agent.id === focused.id) || !wantsLabel(agent)) {
      continue;
    }
    if (!drawMiniLabel(grid, labelReserved, agent)) {
      drawInitialLabel(grid, labelReserved, agent);
    }
  }

  if (focused) {
    if (!drawBubble(grid, characterReserved, focused)
      && wantsLabel(focused)
      && !drawMiniLabel(grid, labelReserved, focused)) {
      drawInitialLabel(grid, labelReserved, focused);
    }
  }

  return grid;
}

function paintMapCell(ch) {
  if (ch === '▬') return cell('▬', UI.desk);
  if (ch === 'n') return cell(' ', undefined);
  if (ch === '▣') return cell('▣', UI.coffee);
  if (ch === '~') return cell('~', UI.couch);
  if (ch === '❀') return cell('❀', UI.plant);
  if (ch === 'w' || ch === 'k') return cell(' ', undefined);
  if (ch === '.' || ch === '+') return cell(' ', undefined);
  return cell(ch, UI.wall);
}

// The sun crosses the windows through the day; the moon takes the night shift.
function drawSky(grid, now) {
  const date = new Date(now);
  const hour = date.getHours() + date.getMinutes() / 60;
  const day = hour >= 7 && hour < 19;
  const progress = day ? (hour - 7) / 12 : ((hour - 19 + 24) % 24) / 12;
  const litWindow = Math.min(WINDOWS.length - 1, Math.floor(progress * WINDOWS.length));
  const litCell = Math.floor((progress * WINDOWS.length - litWindow) * 2);

  WINDOWS.forEach((window, index) => {
    const skyColor = day ? UI.skyDay : UI.skyNight;
    const drift = (Math.floor(now / 1600) + index) % 4;
    const texture = day
      ? ['··', '· ', ' ·', '  '][drift]
      : ['· ', '·˙', ' ·', '˙ '][drift];
    setCell(grid, window.x, window.y, texture[0], skyColor);
    setCell(grid, window.x + 1, window.y, texture[1], skyColor);
    if (index === litWindow) {
      setCell(grid, window.x + Math.min(1, litCell), window.y, day ? '☼' : '☽', day ? UI.coffee : UI.clock);
    }
  });
}

// Text is overlaid after the map is painted, so labels never collide with the
// art legend characters.
function drawRoomLabels(grid) {
  const label = '╡ break room ╞';
  const start = BREAK_ROOM.x + Math.floor((BREAK_ROOM.w - label.length) / 2);
  for (let index = 0; index < label.length; index += 1) {
    setCell(grid, start + index, BREAK_ROOM.y, label[index], UI.wall);
  }
}

function drawClock(grid, now) {
  if (!CLOCK_AT) {
    return;
  }
  const date = new Date(now);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const colon = Math.floor(now / 1000) % 2 === 0 ? ':' : ' ';
  const text = `${hh}${colon}${mm}`;
  for (let index = 0; index < text.length; index += 1) {
    setCell(grid, CLOCK_AT.x + index, CLOCK_AT.y, text[index], UI.clock);
  }
}

function drawCoffeeSteam(grid, now) {
  const frames = [' ', '˙', '·', '˙'];
  const steam = frames[Math.floor(now / 400) % frames.length];
  if (isFloor(COFFEE.x, COFFEE.y - 1)) {
    setCell(grid, COFFEE.x, COFFEE.y - 1, steam, UI.muted);
  }
}

function drawRoomba(grid, now, agents) {
  setCell(grid, ROOMBA_DOCK.x, ROOMBA_DOCK.y, '▪', UI.muted);
  if (!ROOMBA_CIRCUIT.length) {
    return;
  }
  const spot = ROOMBA_CIRCUIT[Math.floor(now / 500) % ROOMBA_CIRCUIT.length];
  const occupied = agents.some((agent) => (
    (agent.x === spot.x && agent.y === spot.y) || (agent.x === spot.x && agent.y + 1 === spot.y)
  ));
  if (!occupied) {
    setCell(grid, spot.x, spot.y, '●', UI.muted);
  }
}

function buildRoombaCircuit() {
  const top = 9;
  const bottom = MAP_H - 2;
  const left = 4;
  const right = MAP_W - 3;
  const circuit = [];
  for (let x = left; x <= right; x += 1) circuit.push({ x, y: bottom });
  for (let y = bottom - 1; y >= top; y -= 1) circuit.push({ x: right, y });
  for (let x = right - 1; x >= left; x -= 1) circuit.push({ x, y: top });
  for (let y = top + 1; y <= bottom - 1; y += 1) circuit.push({ x: left, y });
  return circuit.every((spot) => isWalk(spot.x, spot.y)) ? circuit : [];
}

// ── Agents, labels, bubbles ─────────────────────────────────────────────────

function drawAgent(grid, agent, tick) {
  const color = agent.status === 'stopped' ? UI.muted : agent.color;
  const hat = agent.surface === 'desktop' ? '▔' : '˙';
  if (isFloor(agent.x, agent.y - 1)) {
    setCell(grid, agent.x, agent.y - 1, hat, color);
  }
  setCell(grid, agent.x, agent.y, 'o', color, true);
  if (isWalk(agent.x, agent.y + 1)) {
    setCell(grid, agent.x, agent.y + 1, bodyChar(agent, tick), color);
  }
  if (agent.state === 'coffee' || agent.state === 'sip') {
    const cupX = isFloor(agent.x + agent.dir, agent.y) ? agent.x + agent.dir : agent.x - agent.dir;
    if (isFloor(cupX, agent.y)) {
      setCell(grid, cupX, agent.y, 'u', UI.coffee);
    }
  }
}

// Lounging agents are self-explanatory (cup in hand, feet on the couch) and the
// break room is cramped — no name tags in there.
function wantsLabel(agent) {
  return !['coffee', 'sip', 'couch'].includes(agent.state) && !inBreakRoom(agent.x, agent.y);
}

function inBreakRoom(x, y) {
  return x >= BREAK_ROOM.x && x <= BREAK_ROOM.x + BREAK_ROOM.w - 1 && y >= BREAK_ROOM.y && y <= BREAK_ROOM.y + 4;
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
    const color = breakIndex >= 0 && index > breakIndex ? UI.muted : agent.color;
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

// The focused agent gets a full speech bubble. It may float over furniture
// (bubbles live above the scene), flipping below the agent when the top of the
// map is too close.
function drawBubble(grid, reserved, agent) {
  const header = truncatePlain(`${agent.name} · ${agent.tag}`, MAP_W - 8);
  const task = truncatePlain(agent.task, MAP_W - 8);
  const innerWidth = Math.max(header.length, task.length) + 2;
  const totalWidth = Math.min(MAP_W - 2, innerWidth + 2);
  const flip = agent.y - 4 < 1;
  const top = flip ? agent.y + 2 : agent.y - 4;
  const middle = top + 1;
  const bottom = top + 2;
  const tailY = flip ? agent.y + 1 : agent.y - 1;
  if (top < 1 || bottom > MAP_H - 2) {
    return false;
  }

  const start = clamp(agent.x - Math.floor(totalWidth / 2), 1, MAP_W - 1 - totalWidth);
  for (const y of [top, middle, bottom]) {
    for (let offset = 0; offset < totalWidth; offset += 1) {
      // Bubbles float over floor and furniture, but never over walls (that
      // reads as broken geometry) or another agent.
      if (reserved.has(key(start + offset, y)) || isWallCell(start + offset, y)) {
        return false;
      }
    }
  }

  const tailX = clamp(agent.x, start + 1, start + totalWidth - 2);
  for (let x = start; x < start + totalWidth; x += 1) {
    let topCh = '─';
    let bottomCh = '─';
    if (x === start) { topCh = '┌'; bottomCh = '└'; }
    if (x === start + totalWidth - 1) { topCh = '┐'; bottomCh = '┘'; }
    if (x === tailX) {
      if (flip) topCh = '┴';
      else bottomCh = '┬';
    }
    setCell(grid, x, top, topCh, UI.frame);
    setCell(grid, x, bottom, bottomCh, UI.frame);
  }
  setCell(grid, start, middle, '│', UI.frame);
  setCell(grid, start + totalWidth - 1, middle, '│', UI.frame);
  drawBubbleText(grid, start + 2, top, header, agent.name.length, agent.color, totalWidth - 4);
  drawTextCells(grid, start + 2, middle, truncatePlain(task, totalWidth - 4), UI.fg, totalWidth - 4);
  if (tailY > 0 && tailY < MAP_H - 1 && !reserved.has(key(tailX, tailY))) {
    setCell(grid, tailX, tailY, '│', UI.frame);
  }
  return true;
}

function drawBubbleText(grid, x, y, text, nameLength, nameColor, maxWidth) {
  const fitted = truncatePlain(text, maxWidth);
  for (let index = 0; index < fitted.length; index += 1) {
    setCell(grid, x + index, y, fitted[index], index < nameLength ? nameColor : UI.muted);
  }
}

// ── Chrome: title, session list, status bar ─────────────────────────────────

function drawTitle(rows, sessions, paused, now, filter = '') {
  const width = rows[0].length;
  fillRow(rows, 0, ' ', UI.frame);
  let x = drawTextCells(rows, 0, 0, '▍', UI.accent);
  x = drawTextCells(rows, x, 0, 'ai-office', UI.fg);

  if (sessions.length === 0 && !filter) {
    const dots = '.'.repeat(1 + (Math.floor(now / 400) % 3));
    drawTextCells(rows, x + 1, 0, `scanning for agents${dots}`, UI.muted, width - x - 2);
  } else {
    const working = sessions.filter((session) => ['active', 'starting'].includes(session.status)).length;
    const onBreak = sessions.filter((session) => session.status === 'idle').length;
    const parts = [`${sessions.length} agent${sessions.length === 1 ? '' : 's'}`, `${working} working`];
    if (onBreak > 0) {
      parts.push(`${onBreak} on break`);
    }
    drawTextCells(rows, x + 1, 0, `· ${parts.join(' · ')}`, UI.muted, width - x - 2);
  }

  const flags = [
    filter ? `filter "${filter}"` : '',
    paused ? 'paused' : '',
  ].filter(Boolean).join(' · ');
  if (flags) {
    drawTextCells(rows, Math.max(0, width - flags.length - 2), 0, flags, UI.accent);
  }
}

// An empty office should still tell the visitor what happens next.
function drawEmptyHint(rows, mapLeft, filter) {
  const lines = filter
    ? [`nobody here matches "${truncatePlain(filter, 24)}"`, 'esc clears the filter']
    : [
      'the office is empty',
      'start an agent — claude · codex · cursor · aider —',
      'or try the demo:  ai-office --demo',
    ];
  const centerY = 1 + Math.floor(MAP_H / 2) - 1;
  lines.forEach((line, index) => {
    const x = mapLeft + Math.max(2, Math.floor((MAP_W - line.length) / 2));
    drawTextCells(rows, x, centerY + index, line, index === 0 ? UI.fg : UI.muted, MAP_W - 4);
  });
}

function drawSessionList(rows, sessions, selectedIndex, startY, endY) {
  if (startY >= endY || startY >= rows.length - 1) {
    return;
  }
  const width = rows[0].length;
  const maxRows = Math.max(0, endY - startY);
  if (maxRows <= 0) {
    return;
  }
  drawTextCells(rows, 1, startY, 'sessions', UI.muted, width - 2);
  const visibleRows = Math.max(0, maxRows - 1);
  const listStart = startY + 1;
  const first = Math.max(0, Math.min(selectedIndex - Math.floor(visibleRows / 2), Math.max(0, sessions.length - visibleRows)));
  for (let row = 0; row < visibleRows && first + row < sessions.length; row += 1) {
    drawSessionRow(rows, listStart + row, sessions[first + row], first + row === selectedIndex);
  }
  const hidden = sessions.length - visibleRows;
  if (hidden > 0 && visibleRows > 0) {
    drawTextCells(rows, width - 6, startY, `+${hidden}`, UI.muted, 5);
  }
}

function drawSessionRow(rows, y, session, selected) {
  const width = rows[0].length;
  const showCpu = width >= 64 && Number.isFinite(session.cpu);
  const cpuText = showCpu ? formatPercent(session.cpu) : '';
  const nameWidth = 14;
  const taskX = 22 + nameWidth;
  const taskWidth = Math.max(0, width - taskX - (showCpu ? 8 : 1));
  drawTextCells(rows, 1, y, selected ? '›' : ' ', UI.accent);
  drawTextCells(rows, 3, y, '●', session.color);
  drawTextCells(rows, 5, y, truncatePlain(session.name, nameWidth).padEnd(nameWidth, ' '), selected ? UI.fg : UI.muted, nameWidth);
  drawTextCells(rows, 6 + nameWidth, y, `[${session.tag}]`, session.color, 8);
  drawTextCells(rows, 15 + nameWidth, y, activityLabel(session).padEnd(6, ' '), UI.muted, 7);
  drawTextCells(rows, taskX, y, truncatePlain(session.task, taskWidth), selected ? UI.fg : UI.muted, taskWidth);
  if (showCpu) {
    drawTextCells(rows, width - cpuText.length - 1, y, cpuText, cpuColor(session.cpu), 7);
  }
}

function cpuColor(cpu) {
  const value = Number(cpu);
  if (!Number.isFinite(value) || value <= 0) return UI.muted;
  if (value >= 80) return 'red';
  if (value >= 40) return 'yellow';
  return 'green';
}

function drawStatus(rows, sessions, y) {
  const width = rows[0].length;
  fillRow(rows, y, ' ', UI.muted);

  let cpu = 0;
  let rssKb = 0;
  let hasMetrics = false;
  for (const session of sessions) {
    if (Number.isFinite(session.cpu)) { cpu += session.cpu; hasMetrics = true; }
    if (Number.isFinite(session.rssKb)) { rssKb += session.rssKb; hasMetrics = true; }
  }
  const summary = hasMetrics ? `cpu ${formatPercent(cpu)} · mem ${formatMemoryKb(rssKb)}` : '';

  const keys = 'q quit  r rescan  d dashboard  / filter  k signal  p pause  h help';
  drawTextCells(rows, 1, y, keys, UI.muted, Math.max(0, width - summary.length - 4));
  if (summary) {
    drawTextCells(rows, Math.max(0, width - summary.length - 1), y, summary, UI.fg);
  }
}

// ── Text + labels ───────────────────────────────────────────────────────────

function labelText(agent) {
  const name = truncatePlain(agent.name, 9);
  if (agent.state === 'walk') {
    return `${name} ${agent.dir > 0 ? '→' : '←'}`;
  }
  if (agent.toolCall?.shortName && (agent.state === 'type' || agent.state === 'think')) {
    return `${name}·${truncatePlain(agent.toolCall.shortName, 3)}`;
  }
  return `${name}·${verbOf(agent.state)}`;
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
  if (session.status === 'starting') return 'arrive';
  if (session.status === 'stopped') return 'leave';
  if (session.toolCall?.shortName) {
    return truncatePlain(`${session.toolCall.shortName}${session.toolCall.status === 'done' ? '✓' : ''}`, 6);
  }
  return session.previousStatus === 'idle' ? 'return' : 'typing';
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
  const source = String(
    agent.terminalTitle
    || agent.title
    || agent.sessionName
    || basename(agent.projectLabel)
    || basename(agent.projectPath)
    || agent.toolName
    || `ai-${index + 1}`,
  ).trim();
  return truncatePlain(source, 14) || `ai-${index + 1}`;
}

function basename(value) {
  if (!value) {
    return '';
  }
  return String(value).split(/[\\/]/).filter(Boolean).pop() || '';
}

function sessionTask(agent) {
  if (agent.toolCall?.summary && agent.currentTask) {
    return `${agent.toolCall.summary} · ${agent.currentTask}`;
  }
  return String(agent.currentTask || agent.title || agent.sessionName || agent.projectLabel || agent.projectPath || agent.command || agent.toolName || 'agent session');
}

// ── Pathfinding ─────────────────────────────────────────────────────────────

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
  return ch === '.' || ch === '+' || ch === 'n';
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

const WALL_CHARS = '║═╔╗╚╝╡╞┌┐└┘─│wk';

function isWallCell(x, y) {
  const ch = mapChar(x, y);
  return ch === undefined || WALL_CHARS.includes(ch);
}

function canPaintLabel(reserved, x, y) {
  if (x < 1 || y < 1 || x >= MAP_W - 1 || y >= MAP_H - 1) {
    return false;
  }
  return isFloor(x, y) && !reserved.has(key(x, y));
}

// ── Grid primitives ─────────────────────────────────────────────────────────

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

function drawTextCells(grid, x, y, text, color, maxWidth = String(text).length) {
  if (y < 0 || y >= grid.length || maxWidth <= 0) {
    return x;
  }
  const fitted = truncatePlain(String(text), maxWidth);
  for (let index = 0; index < fitted.length; index += 1) {
    const col = x + index;
    if (col < 0 || col >= grid[y].length) {
      continue;
    }
    grid[y][col] = cell(fitted[index], color);
  }
  return x + fitted.length;
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
  renderOffice,
};
