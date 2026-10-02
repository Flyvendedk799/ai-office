const { formatMemoryKb, formatPercent } = require('../util/format');
const { UI, inferVendor, vendorColor } = require('./theme');
const { MAP, MAP_W, MAP_H, SEATS, WINDOWS, MONITORS } = require('./floor');
const { OfficeScene } = require('./motion');
const { renderDashboard } = require('./dashboard');
const { cleanText, truncate, charWidth, textWidth, padRight } = require('../util/text');
const { formatDuration } = require('../util/time');
const STEP_MS = 90;
const ENTRANCE = { x: 1, y: 19 };
const CLOCK_AT = { x: 79, y: 0 };

const COFFEE = findFirst('▣');
const COFFEE_SPOTS = [50, 51, 52, 54, 55, 56, 57, 58, 59, 60, 61, 62].map((x) => ({ x, y: COFFEE.y }));
const COUCH = findFirst('~');
const COUCH_SPOTS = [50, 53, 56, 59, 62, 65, 68, 71, 74, 77, 80, 83].map((x) => ({ x, y: COUCH.y + 1 }));

const BREAK_ROOM = { x: 47, y: 15, w: 39 };
const ROOMBA_DOCK = { x: 3, y: MAP_H - 2 };
// The roomba patrols a rectangular circuit around the open floor, forever.
// If a future floor-plan edit blocks the circuit, it simply stays docked.
const ROOMBA_CIRCUIT = buildRoombaCircuit();
const ROUTE_CACHE = new Map();

function createOfficeScene() {
  return new OfficeScene({ seats: SEATS, entrance: ENTRANCE, coffeeSpots: COFFEE_SPOTS, couchSpots: COUCH_SPOTS, route, initialState: visualState, stepMs: STEP_MS });
}

function renderOffice({ agents = [], allAgents = agents, width = 80, height = 24, now = Date.now(), realNow = now, selectedId, paused = false, reducedMotion = false, filter = '', scene } = {}) {
  const screenWidth = Math.max(1, Math.floor(width || 80));
  const screenHeight = Math.max(1, Math.floor(height || 24));
  const rows = makeGrid(screenWidth, screenHeight);
  const sessions = agents.map((agent, index) => toSession(agent, index, realNow));
  const selectedIndex = Math.max(0, sessions.findIndex((session) => session.id === selectedId));
  const focused = sessions[selectedIndex] || sessions[0];
  const floor = Math.floor((focused?.source.deskIndex ?? focused?.index ?? 0) / SEATS.length);
  const visible = sessions.filter((session) => Math.floor((session.source.deskIndex ?? session.index) / SEATS.length) === floor);
  const allSessions = allAgents.map((agent, index) => toSession(agent, index, realNow));
  const actors = scene ? scene.sync(allSessions, now, realNow, reducedMotion) : allSessions.map((session) => {
    const index = session.source.deskIndex ?? session.index;
    const visual = toOfficeAgent(session, index, now);
    if (reducedMotion) Object.assign(visual, session.status === 'idle' ? breakSpot(COUCH_SPOTS, index) : SEATS[index % SEATS.length], { state: session.status === 'idle' ? 'couch' : 'type' });
    return visual;
  });
  const visibleIds = new Set(visible.map((session) => session.id));
  const officeAgents = actors.filter((actor) => visibleIds.has(actor.id) && actor.state !== 'exit');
  const focusedVisibleIndex = officeAgents.findIndex((session) => session.id === focused?.id);
  const ambientNow = reducedMotion ? new Date(realNow).setMinutes(0, 0, 0) : now;
  if (screenHeight < 16) return renderDashboard({ agents, width: screenWidth, height: screenHeight, now: realNow, selectedId, filter });
  const fullScene = screenWidth >= MAP_W && screenHeight >= MAP_H + 5;
  const sidebar = fullScene && screenWidth >= MAP_W + 38;
  const mapLeft = sidebar ? 1 : Math.max(0, Math.floor((screenWidth - MAP_W) / 2));

  drawTitle(rows, sessions, paused, now, filter);
  if (fullScene) {
    pasteMap(rows, renderMap(officeAgents, focusedVisibleIndex, ambientNow, realNow), mapLeft, 1);
    if (!sessions.length) drawEmptyHint(rows, mapLeft, filter);
    if (sidebar) drawInspector(rows, MAP_W + 3, focused, realNow);
  } else {
    drawCompactOffice(rows, sessions, selectedIndex, ambientNow, reducedMotion, filter);
  }
  drawSessionList(rows, sessions, selectedIndex, fullScene ? 1 + MAP_H : 10, screenHeight - 2);
  if (focused) drawTextCells(rows, 1, screenHeight - 2, `› ${focused.name} · ${focused.task}`, UI.fg, screenWidth - 2);
  if (fullScene && Math.max(...allSessions.map((session) => session.source.deskIndex ?? session.index), 0) >= SEATS.length) {
    drawTextCells(rows, mapLeft + 2, MAP_H, ` floor ${floor + 1} · select an agent to follow `, UI.accent, MAP_W - 4);
  }
  drawStatus(rows, sessions, screenHeight - 1);

  return gridToBlessed(rows);
}

function drawCompactOffice(rows, sessions, selectedIndex, now, reducedMotion, filter) {
  const width = rows[0].length;
  const roomWidth = Math.min(width - 2, 72);
  const left = Math.max(0, Math.floor((width - roomWidth) / 2));
  if (roomWidth < 8) return;
  drawTextCells(rows, left, 2, `╔${'═'.repeat(roomWidth - 2)}╗`, UI.wall);
  drawTextCells(rows, left, 8, `╚${'═'.repeat(roomWidth - 2)}╝`, UI.wall);
  for (let y = 3; y < 8; y++) { setCell(rows, left, y, '║', UI.wall); setCell(rows, left + roomWidth - 1, y, '║', UI.wall); }
  const count = Math.max(1, Math.floor((roomWidth - 4) / 15));
  const first = Math.floor(selectedIndex / count) * count;
  for (let index = 0; index < count && first + index < sessions.length; index++) {
    const session = sessions[first + index];
    const x = left + 2 + index * 15;
    drawTextCells(rows, x, 3, truncatePlain(session.name, 12), session.color, 12);
    drawTextCells(rows, x + 2, 4, session.status === 'idle' ? '  ~ u  ' : '[ >_ ]', session.color, 8);
    drawTextCells(rows, x, 5, '▬▬▬▬▬▬▬▬▬▬▬', UI.desk, 12);
    setCell(rows, x + 5, 6, 'o', session.color, true);
    setCell(rows, x + 5, 7, session.status === 'idle' ? '_' : reducedMotion ? 'T' : Math.floor(now / 180) % 2 ? 'Y' : 'T', session.color);
    if (first + index === selectedIndex) setCell(rows, x, 6, '›', UI.accent);
  }
  if (!sessions.length) {
    drawTextCells(rows, left + 2, 4, filter ? 'No agents match this filter.' : 'the office is empty · scanning for agents', UI.fg, roomWidth - 4);
    drawTextCells(rows, left + 2, 6, 'try: ai-office --demo', UI.muted, roomWidth - 4);
  }
  drawTextCells(rows, 1, 9, 'compact studio · d metrics · enlarge for the full office', UI.muted, width - 2);
}

function drawInspector(rows, left, session, now) {
  const width = rows[0].length - left - 2;
  for (let y = 2; y < MAP_H; y++) setCell(rows, left - 2, y, '│', UI.frame);
  drawTextCells(rows, left, 2, 'SESSION IN FOCUS', UI.accent, width);
  if (!session) { drawTextCells(rows, left, 4, 'Waiting for your first agent.', UI.muted, width); return; }
  const agent = session.source;
  const lines = [session.title || session.name, `${agent.toolName} · ${session.status}`, '', 'CURRENT TASK', ...wrapText(session.task, width).slice(0, 3), '', 'PROJECT', ...wrapText(agent.projectPath || agent.projectLabel || 'Not identified', width).slice(0, 2), '', `CPU ${formatPercent(agent.cpu)} · MEM ${formatMemoryKb(agent.rssKb)}`, `PID ${agent.pid} · UP ${formatDuration(agent.status === 'stopped' ? agent.runtimeMs : now - (agent.startedAt ?? now))}`, '', `Source: ${agent.metadataSource || agent.source || 'process'}`, 'Status inferred from local activity', '', '↑↓ select · / filter', 'e activity · d dashboard'];
  lines.forEach((line, index) => drawTextCells(rows, left, 4 + index, line, index === 0 ? session.color : UI.muted, width));
}

function wrapText(value, width) {
  let text = cleanText(value);
  const lines = [];
  while (text) {
    let part = truncate(text, Math.max(1, width), '');
    if (!part) part = Array.from(text)[0];
    const space = part.lastIndexOf(' ');
    if (part.length < text.length && space > part.length / 2) part = part.slice(0, space + 1);
    lines.push(part.trimEnd());
    text = text.slice(part.length).trimStart();
  }
  return lines.length ? lines : [''];
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
    color: vendor === 'ai' ? agent.color || UI.fg : vendorColor(vendor),
    name: shortHandle(agent, index),
    task: sessionTask(agent),
    title: agent.terminalTitle || agent.title || agent.sessionName,
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
    const elapsed = Math.max(0, now - (session.stoppedAt ?? session.statusChangedAt));
    if (elapsed >= (route(seat, ENTRANCE).length - 1) * STEP_MS) return { ...ENTRANCE, state: 'exit', dir };
    return onRoute(seat, ENTRANCE, elapsed, 'walk', dir);
  }

  const enterRoute = route(ENTRANCE, seat);
  const enterDuration = Math.max(900, enterRoute.length * STEP_MS);
  if (session.status === 'starting' || age < enterDuration) {
    return onRoute(ENTRANCE, seat, age, 'walk', dir);
  }

  if (session.status === 'idle') {
    const coffee = breakSpot(COFFEE_SPOTS, index);
    const couch = breakSpot(COUCH_SPOTS, index);
    const toCoffee = route(seat, coffee);
    const toCoffeeDuration = toCoffee.length * STEP_MS;
    if (statusAge < toCoffeeDuration) {
      return onRoute(seat, coffee, statusAge, 'walk', dir);
    }
    const phase = statusAge - toCoffeeDuration;
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
    return { ...couch, state: 'couch', dir };
  }

  const returnCoffee = breakSpot(COFFEE_SPOTS, index);
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

function renderMap(agents, focusIndex, now, realNow = now) {
  const tick = Math.floor(now / 100);
  const grid = MAP.map((row) => row.map((ch) => paintMapCell(ch)));

  drawRoomLabels(grid);
  drawSky(grid, now);
  drawClock(grid, realNow, now);
  drawMonitors(grid, agents, now);
  drawServerRack(grid, now);
  drawFloorTexture(grid);
  drawPlants(grid, now);
  drawCoffeeSteam(grid, now);
  drawRoomba(grid, now, agents);

  for (const agent of agents) {
    drawAgent(grid, agent, tick);
  }

  const characterReserved = new Set();
  for (const agent of agents) {
    for (let y = agent.y - 1; y <= agent.y + 1; y++) {
      for (let x = agent.x - 1; x <= agent.x + 1; x++) characterReserved.add(key(x, y));
    }
    if (agent.state === 'coffee' || agent.state === 'sip') {
      characterReserved.add(key(agent.x + agent.dir, agent.y));
    }
  }

  const focused = agents[focusIndex];
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
    if (isFloor(focused.x - 3, focused.y)) setCell(grid, focused.x - 3, focused.y, '›', UI.accent, true);
  }

  return grid;
}

function paintMapCell(ch) {
  if (ch === '▬') return cell('▬', UI.desk);
  if (ch === 'n') return cell(' ', undefined);
  if (ch === '▣') return cell('▣', UI.coffee);
  if (ch === '~') return cell('~', UI.couch);
  if (ch === '❀') return cell('❀', UI.plant);
  if (ch === 'w' || ch === 'k' || ch === 'r') return cell(' ', undefined);
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
  const litCell = Math.floor((progress * WINDOWS.length - litWindow) * WINDOWS[0].width);

  WINDOWS.forEach((window, index) => {
    const skyColor = day ? UI.skyDay : UI.skyNight;
    for (let x = 0; x < window.width; x++) {
      const drift = (x + Math.floor(now / 900) + index * 3) % 19;
      const ch = day ? (drift < 4 ? '._~.'[drift] : ' ') : (drift === 2 ? '*' : drift === 9 ? '·' : ' ');
      setCell(grid, window.x + x, window.y, ch, skyColor);
    }
    if (index === litWindow) {
      setCell(grid, window.x + Math.min(window.width - 1, litCell), window.y, day ? '☼' : '☽', day ? UI.coffee : UI.clock);
    }
  });
}

function drawMonitors(grid, agents, now) {
  const frames = ['>_   ', '>.._ ', '>>_  ', '>..._', '>>>_ ', '> ._ '];
  for (const monitor of MONITORS) {
    const agent = agents.find((item) => item.idNumber % SEATS.length === monitor.seatIndex);
    const working = agent && ['type', 'think'].includes(agent.state) && agent.status !== 'stopped';
    const frame = working ? frames[(Math.floor(now / 140) + monitor.seatIndex * 2) % frames.length] : agent?.status === 'idle' ? ' z.z ' : '  ·  ';
    drawTextCells(grid, monitor.x, monitor.y, frame, working ? agent.color : UI.muted, 5);
  }
}

function drawServerRack(grid, now) {
  for (let y = 6; y <= 9; y++) {
    setCell(grid, 82, y, (Math.floor(now / (260 + y * 20)) + y) % 3 ? '●' : '·', y === 9 ? UI.accent : 'green');
  }
  drawTextCells(grid, 80, 12, 'server', UI.muted, 6);
}

function drawFloorTexture(grid) {
  for (let y = 4; y < MAP_H - 1; y += 5) {
    for (let x = 4; x < MAP_W - 2; x += 9) if (isFloor(x, y) && !inBreakRoom(x, y)) setCell(grid, x, y, '·', UI.floor);
  }
}

function drawPlants(grid, now) {
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      if (MAP[y][x] !== '❀') continue;
      const offset = (Math.floor(now / 800) + x) % 4 < 2 ? -1 : 1;
      if (isFloor(x + offset, y)) setCell(grid, x + offset, y, offset < 0 ? '(' : ')', UI.plant);
    }
  }
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

function drawClock(grid, now, animationNow = now) {
  if (!CLOCK_AT) {
    return;
  }
  const date = new Date(now);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const colon = Math.floor(animationNow / 1000) % 2 === 0 ? ':' : ' ';
  const text = `${hh}${colon}${mm}`;
  for (let index = 0; index < text.length; index += 1) {
    setCell(grid, CLOCK_AT.x + index, CLOCK_AT.y, text[index], UI.clock);
  }
}

function drawCoffeeSteam(grid, now) {
  const frames = ['~', '˙', '·', '~', ' '];
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
  const spot = ROOMBA_CIRCUIT[Math.floor(now / 120) % ROOMBA_CIRCUIT.length];
  const occupied = agents.some((agent) => (
    (agent.x === spot.x && agent.y === spot.y) || (agent.x === spot.x && agent.y + 1 === spot.y)
  ));
  if (!occupied) {
    setCell(grid, spot.x, spot.y, Math.floor(now / 240) % 2 ? '◉' : '●', UI.accent);
  }
}

function buildRoombaCircuit() {
  const top = 14;
  const bottom = MAP_H - 2;
  const left = 3;
  const right = MAP_W - 2;
  const circuit = [];
  for (let x = left; x <= right; x += 1) circuit.push({ x, y: bottom });
  for (let y = bottom - 1; y >= top; y -= 1) circuit.push({ x: right, y });
  for (let x = right - 1; x >= left; x -= 1) circuit.push({ x, y: top });
  for (let y = top + 1; y <= bottom - 1; y += 1) circuit.push({ x: left, y });
  return circuit.every((spot) => isWalk(spot.x, spot.y)) ? circuit : [];
}

// ── Agents, labels, bubbles ─────────────────────────────────────────────────

function drawAgent(grid, agent, tick) {
  if (agent.state === 'exit') return;
  const color = agent.status === 'stopped' ? UI.muted : agent.color;
  const hat = agent.surface === 'desktop' ? '▔' : '˙';
  if (isFloor(agent.x, agent.y - 1)) {
    setCell(grid, agent.x, agent.y - 1, hat, color);
  }
  setCell(grid, agent.x, agent.y, 'o', color, true);
  if (agent.state === 'type' || agent.state === 'think') {
    const hands = agent.state === 'think' ? [' ', '?'] : tick % 4 < 2 ? ['/', '\\'] : ['─', '─'];
    for (const [offset, ch] of [[-1, hands[0]], [1, hands[1]]]) {
      if (isFloor(agent.x + offset, agent.y)) setCell(grid, agent.x + offset, agent.y, ch, color);
    }
  }
  if (isWalk(agent.x, agent.y + 1)) {
    setCell(grid, agent.x, agent.y + 1, bodyChar(agent, tick), color);
  }
  if (agent.state === 'walk') {
    const side = tick % 4 < 2 ? -1 : 1;
    if (isFloor(agent.x + side, agent.y + 1)) setCell(grid, agent.x + side, agent.y + 1, side < 0 ? '/' : '\\', color);
  }
  if (agent.state === 'couch') {
    const sleepY = agent.y - (tick % 16 < 8 ? 1 : 2);
    if (isFloor(agent.x + 1, sleepY)) setCell(grid, agent.x + 1, sleepY, tick % 16 < 8 ? 'z' : 'Z', UI.muted);
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
    return tick % 4 < 2 ? '/' : '\\';
  }
  if (agent.state === 'couch') {
    return '_';
  }
  if (agent.state === 'type') {
    return tick % 4 < 2 ? 'T' : 'Y';
  }
  return 'Y';
}

function drawMiniLabel(grid, reserved, agent) {
  const text = labelText(agent);
  const labelWidth = textWidth(text);
  const y = ['type', 'think'].includes(agent.state) ? agent.y - 4 : agent.y - 1;
  const start = clamp(agent.x - Math.floor(labelWidth / 2), 1, MAP_W - 1 - labelWidth);
  if ((start > 1 && !canPaintLabel(reserved, start - 1, y)) || (start + labelWidth < MAP_W - 1 && !canPaintLabel(reserved, start + labelWidth, y))) {
    return false;
  }
  for (let index = 0; index < labelWidth; index += 1) {
    if (!canPaintLabel(reserved, start + index, y)) {
      return false;
    }
  }
  drawTextCells(grid, start, y, text, agent.color, labelWidth);
  for (let index = 0; index < labelWidth; index += 1) {
    reserved.add(key(start + index, y));
  }
  if (start > 1 && isFloor(start - 1, y)) {
    reserved.add(key(start - 1, y));
  }
  if (start + labelWidth < MAP_W - 1 && isFloor(start + labelWidth, y)) {
    reserved.add(key(start + labelWidth, y));
  }
  return true;
}

function drawInitialLabel(grid, reserved, agent) {
  const y = agent.y - 1;
  if (!canPaintLabel(reserved, agent.x, y)) {
    return;
  }
  drawTextCells(grid, agent.x, y, Array.from(agent.name)[0] || '?', agent.color, 2);
  reserved.add(key(agent.x, y));
}

// The focused agent gets a full speech bubble. It may float over furniture
// (bubbles live above the scene), flipping below the agent when the top of the
// map is too close.
function drawBubble(grid, reserved, agent) {
  const header = truncatePlain(`${agent.name} · ${agent.tag}`, 30);
  const task = truncatePlain(agent.task, 30);
  const innerWidth = Math.max(textWidth(header), textWidth(task)) + 2;
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
  const name = fitted.slice(0, nameLength);
  const next = drawTextCells(grid, x, y, name, nameColor, maxWidth);
  drawTextCells(grid, next, y, fitted.slice(nameLength), UI.muted, maxWidth - textWidth(name));
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
  drawTextCells(rows, 5, y, padRight(session.name, nameWidth, '…'), selected ? UI.fg : UI.muted, nameWidth);
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

  const keys = 'q quit  d dashboard  e activity  / filter  p pause  m motion  h help';
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
  if (sx === tx && sy === ty) return [{ x: sx, y: sy }];
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
    return [{ x: sx, y: sy }];
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

function drawTextCells(grid, x, y, text, color, maxWidth = textWidth(text)) {
  if (y < 0 || y >= grid.length || maxWidth <= 0) {
    return x;
  }
  const fitted = truncatePlain(String(text), maxWidth);
  let col = x;
  for (const ch of fitted) {
    const size = charWidth(ch);
    if (col + size > grid[y].length) break;
    if (size === 0) { if (col > 0 && grid[y][col - 1]) grid[y][col - 1].ch += ch; continue; }
    if (col >= 0) {
      grid[y][col] = cell(ch, color);
      if (size === 2) grid[y][col + 1] = cell('', color);
    }
    col += size;
  }
  return col;
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
  return truncate(value, maxLength, '…');
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
  createOfficeScene,
  MAP_H,
  MAP_W,
  SEATS,
  renderOffice,
  route,
  toSession,
};
