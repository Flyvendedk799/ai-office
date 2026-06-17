const { formatDuration } = require('../util/time');
const { truncate } = require('../util/text');
const { computeOfficeLayout } = require('./animation');
const { renderDesignOffice } = require('./designRenderer');

function renderOffice({ worldFrame, animator, agents = [], width, height, now, selectedId, paused, showDebugRoutes = false, filter = '' }) {
  const frameAgents = worldFrame?.agents || [];
  const focusedId = selectedId || frameAgents.find((agent) => agent.selected)?.id;
  return renderDesignOffice({
    agents,
    width: Math.max(28, Math.floor(width || worldFrame?.width || 80)),
    height: Math.max(10, Math.floor(height || worldFrame?.height || 24)),
    now: now || worldFrame?.now || Date.now(),
    selectedId: focusedId,
    paused,
    showDebugRoutes,
    filter,
  });
}

function renderDetails(agent, { now, debugLines = [], logger, demo = false, showDebugRoutes = false }) {
  const lines = [];
  if (!agent) {
    lines.push('{bold}No selected agent{/bold}');
    lines.push('');
    lines.push('Detected agents will appear here.');
    lines.push(demo ? 'Demo mode is running.' : 'Press r to rescan.');
    return lines.join('\n');
  }

  const runtime = agent.startedAt ? formatDuration(now - agent.startedAt) : formatDuration(agent.runtimeMs || 0);
  lines.push(`Tool:   {bold}${escapeTag(agent.toolName)}{/bold}`);
  lines.push(`Status: {${agent.color || 'white'}-fg}${escapeTag(agent.status)}{/}`);
  lines.push('');
  lines.push(`Title:   ${escapeTag(agent.title || '-')}`);
  lines.push(`Session: ${escapeTag(agent.sessionName || '-')}`);
  lines.push(`Working: ${escapeTag(agent.currentTask || '-')}`);
  lines.push(`Activity:${escapeTag(agent.activity ? ` ${agent.activity}` : ' -')}`);
  lines.push(`Tool:    ${escapeTag(agent.toolCall?.summary || '-')}`);
  lines.push(`Project: ${escapeTag(agent.projectLabel || agent.projectPath || '-')}`);
  lines.push(`Model:   ${escapeTag(agent.modelName || '-')}`);
  lines.push(`PID:     ${agent.pid}${agent.pids && agent.pids.length > 1 ? ` (${agent.pids.length} processes)` : ''}`);
  lines.push(`Runtime: ${runtime}`);
  lines.push(`Source:  ${escapeTag(agent.source || '-')}`);
  lines.push(`Meta:    ${escapeTag(agent.metadataSource || '-')}`);
  lines.push(`Score:   ${Math.round((agent.confidence || 0) * 100)}%`);
  if (agent.metadataConfidence) {
    lines.push(`Match:   ${Math.round(agent.metadataConfidence * 100)}% ${escapeTag(agent.metadataReason || '')}`);
  }
  lines.push(`Routes:  ${showDebugRoutes ? 'visible' : 'hidden'}`);
  lines.push('');
  lines.push('{bold}Command{/bold}');
  lines.push(escapeTag(truncate(agent.command || '-', 72)));

  if (logger?.isDebug()) {
    lines.push('');
    lines.push('{bold}Debug log{/bold}');
    lines.push(escapeTag(logger.logPath));
    for (const line of debugLines.slice(-5)) {
      lines.push(escapeTag(truncate(line, 72)));
    }
  }

  return lines.join('\n');
}

function renderFooter({ count, scanIntervalMs, paused, lastScanLabel, showDebugRoutes = false }) {
  return [
    ` q quit | r rescan | tab/arrows select | h help | p ${paused ? 'resume' : 'pause'} | v routes ${showDebugRoutes ? 'on' : 'off'} `,
    ` agents ${count} | scan ${scanIntervalMs}ms | last ${lastScanLabel || '-'} `,
  ].join('\n');
}

function renderHelp() {
  return [
    '{bold}Agent Office — Help{/bold}',
    '',
    '{bold}Navigation{/bold}',
    '  q / Ctrl-C   Quit             r   Rescan now',
    '  tab / ↓ →    Select next      ← ↑ Select previous',
    '  d / o        Office ⇄ Dashboard view',
    '  h            Toggle this help  esc Close / clear filter',
    '',
    '{bold}Dashboard{/bold}',
    '  s            Cycle sort (cpu · mem · runtime · tool · status · name)',
    '  /            Filter sessions by text (enter apply · esc clear)',
    '',
    '{bold}Agent actions{/bold}',
    '  k            Signal selected agent (SIGTERM / SIGINT / SIGKILL)',
    '  c            Show a "cd <project>" hint for the selected agent',
    '  p            Pause animation   v   Toggle route overlay',
    '',
    'Local-only and best-effort: reads process + session metadata only.',
    'No telemetry, network, clipboard, keylog, or file-content access.',
  ].join('\n');
}

function computeDesks(width, height, count) {
  return computeOfficeLayout(width, height, count).desks;
}

function officeTitle(visibleAgents, allAgents, paused) {
  const counts = visibleAgents.reduce((memo, agent) => {
    const key = agent.status === 'idle' ? 'idle' : agent.status === 'stopped' ? 'leaving' : 'active';
    memo[key] = (memo[key] || 0) + 1;
    return memo;
  }, {});
  const totalCount = allAgents.length || visibleAgents.length;
  const parts = [
    ' AGENT OFFICE ',
  ];
  parts.push(`live:${totalCount}`);
  if (visibleAgents.length < totalCount) {
    parts.push(`shown:${visibleAgents.length}`);
  }
  parts.push(`work:${counts.active || 0}`);
  parts.push(`coffee:${counts.idle || 0}`);
  if (counts.leaving) {
    parts.push(`leaving:${counts.leaving}`);
  }
  if (paused) {
    parts.push('PAUSED');
  }
  return ` ${parts.join(' | ')} `;
}

function drawLegend(grid, agents, layout) {
  if (layout.width < 74 || grid.length < 8) {
    return;
  }
  const profiles = uniqueProfiles(agents);
  if (!profiles.length) {
    return;
  }
  const maxX = Math.min(layout.breakRoom.x - 3, layout.width - 4);
  let x = 3;
  const y = 1;
  drawTextIfBlank(grid, x, y, 'legend', 'gray');
  x += 8;
  for (const profile of profiles) {
    const label = `${profile.badge} ${profile.name}`;
    if (x + label.length > maxX) {
      break;
    }
    drawTextIfBlank(grid, x, y, label, profile.color);
    x += label.length + 3;
  }
}

function uniqueProfiles(agents) {
  const seen = new Set();
  const profiles = [];
  for (const agent of agents) {
    const badge = toolBadge(agent);
    if (seen.has(badge)) {
      continue;
    }
    seen.add(badge);
    profiles.push({
      badge,
      name: shortToolName(agent),
      color: agent.color || 'white',
    });
  }
  return profiles.sort((a, b) => toolPriority(a.badge) - toolPriority(b.badge));
}

function shortToolName(agent) {
  const key = String(agent?.toolKey || agent?.toolName || '').toLowerCase();
  if (key.includes('codex')) {
    return 'Codex';
  }
  if (key.includes('claude')) {
    return 'Claude';
  }
  if (key.includes('cursor')) {
    return 'Cursor';
  }
  if (key.includes('aider')) {
    return 'Aider';
  }
  if (key.includes('gemini')) {
    return 'Gemini';
  }
  if (key.includes('unknown')) {
    return 'Unknown';
  }
  return truncate(String(agent?.toolName || agent?.toolKey || 'AI'), 8);
}

function toolPriority(badge) {
  const order = ['Cx', 'Cl', 'Cu', 'Ai', 'Gm', '??'];
  const index = order.indexOf(badge);
  return index === -1 ? order.length : index;
}

function drawFloor(grid, layout, agents = [], now = Date.now()) {
  const aisleY = layout.mainAisleY || (layout.desks[0] ? Math.max(3, layout.desks[0].y - 6) : 3);
  const corridorEnd = Math.max(8, Math.min(layout.breakRoom.x - 2, grid[0].length - 4));

  drawFloorTiles(grid, layout);
  drawWindows(grid, layout, now);
  drawReceptionCue(grid, layout);
  drawAisleRug(grid, 3, aisleY, corridorEnd);
  drawCarpetColumn(grid, layout.entrance.x, Math.min(aisleY, layout.entrance.y), Math.max(aisleY, layout.entrance.y));
  drawDeskAisles(grid, layout);

  drawEntrance(grid, layout, agents);
  drawPlant(grid, layout);
}

function drawFloorTiles(grid, layout) {
  const bottom = Math.min(layout.rosterY - 1, grid.length - 2);
  for (let y = 3; y < bottom; y += 4) {
    for (let x = 4 + (y % 8 === 0 ? 6 : 0); x < grid[0].length - 4; x += 22) {
      if (x >= layout.breakRoom.x - 2 && y <= layout.breakRoom.y + layout.breakRoom.h + 1) {
        continue;
      }
      drawTextIfBlank(grid, x, y, '.', 'gray');
    }
  }
}

function drawDeskAisles(grid, layout) {
  for (const desk of layout.desks) {
    const chair = desk.zones?.chair;
    if (!chair) {
      continue;
    }
    const fromY = Math.min(chair.y, layout.mainAisleY);
    const toY = Math.max(chair.y, layout.mainAisleY);
    for (let y = fromY; y <= toY; y += 1) {
      if ((y - fromY) % 2 !== 0) {
        continue;
      }
      drawTextIfBlank(grid, chair.x, y, '.', 'gray');
    }
  }
}

function drawEntrance(grid, layout, agents) {
  const x = Math.max(2, layout.entrance.x - 9);
  const y = layout.entrance.y;
  const activeDoor = agents.some((agent) => ['entering', 'leaving'].includes(agent.action) && Math.abs(agent.position.y - y) < 4);
  drawText(grid, x, y, activeDoor ? 'ENT [  ]' : 'ENT [||]', activeDoor ? 'yellow' : 'white');
}

function drawDesk(grid, desk, agent, now) {
  const borderColor = agent?.selected ? 'yellow' : 'gray';
  drawChair(grid, desk, agent);
  drawBorder(grid, desk.x, desk.y, desk.w, desk.h, '', borderColor);
  drawText(grid, desk.x + 1, desk.y + 1, fitCell(deskIdentity(agent), desk.w - 2), agent?.color || 'white');
  drawText(grid, desk.x + 1, desk.y + 2, fitCell(monitorLine(agent, now), desk.w - 2), monitorColor(agent));
  if (desk.h >= 5) {
    drawText(grid, desk.x + 1, desk.y + 3, fitCell(deskStatus(agent), desk.w - 2), agent?.status === 'idle' ? 'magenta' : 'gray');
  }
}

function monitorColor(agent) {
  if (!agent) {
    return 'gray';
  }
  if (agent.action === 'coffee' || agent.action === 'toBreak') {
    return 'gray';
  }
  if (agent.action === 'leaving') {
    return 'yellow';
  }
  return 'cyan';
}

function drawBreakRoom(grid, room, now = Date.now()) {
  drawRoomWithDoor(grid, room, ' BREAK ROOM ', 'magenta');
  drawText(grid, room.x + 2, room.y + 1, truncate(room.w >= 22 ? 'coffee bar' : 'coffee', room.w - 4), 'magenta');
  if (room.h >= 8) {
    drawText(grid, room.x + 2, room.y + 2, truncate(room.w >= 22 ? '[c] [u] [u]' : '[c] [u]', room.w - 4), 'white');
  }
  drawCoffeeSteam(grid, room, now);
  if (room.w >= 24 && room.h >= 9) {
    drawText(grid, room.x + room.w - 10, room.y + 3, 'table(o)', 'white');
  }
  if (room.h >= 7) {
    const sofa = room.w >= 23 ? 'sofa [_][_]' : 'sofa [_]';
    drawText(grid, room.x + 2, room.y + room.h - 2, truncate(sofa, room.w - 4), 'white');
  }
}

function drawAgent(grid, agent) {
  const centerX = Math.max(3, Math.min(grid[0].length - 4, Math.round(agent.position.x)));
  const centerY = Math.max(3, Math.min(grid.length - 4, Math.round(agent.position.y)));
  drawSpriteCentered(grid, centerX, centerY, agent.sprite, {
    headColor: agent.color || 'white',
    bodyColor: undefined,
  });
}

function drawAgentShadow(grid, agent) {
  if (agent.action === 'working') {
    return;
  }
  const x = Math.round(agent.position.x) - 1;
  const y = Math.round(agent.position.y) + 2;
  if (canPlaceSoft(grid, x, y, '...')) {
    drawText(grid, x, y, '...', 'gray');
  }
}

function drawMotionTrail(grid, agent, now) {
  if (agent.routeDone || ['working', 'coffee'].includes(agent.action)) {
    return;
  }
  const phase = Math.floor((now - (agent.routeStartedAt || now)) / 120) % 2;
  const mark = phase === 0 ? '.' : "'";
  const x = Math.round(agent.position.x);
  const y = Math.round(agent.position.y);
  const offsets = trailOffsets(agent.direction || 'right');
  for (let index = 0; index < offsets.length; index += 1) {
    const point = offsets[index];
    const text = index === 0 ? mark : '.';
    drawTextIfSoft(grid, x + point.x, y + point.y, text, 'gray');
  }
}

function trailOffsets(direction) {
  if (direction === 'left') {
    return [{ x: 3, y: 1 }, { x: 5, y: 1 }];
  }
  if (direction === 'up') {
    return [{ x: -1, y: 3 }, { x: 1, y: 3 }];
  }
  if (direction === 'down') {
    return [{ x: -1, y: -3 }, { x: 1, y: -3 }];
  }
  return [{ x: -3, y: 1 }, { x: -5, y: 1 }];
}

function drawAgentTag(grid, agent) {
  const needsTag = !agent.routeDone || ['entering', 'toBreak', 'coffee', 'returning', 'leaving'].includes(agent.action);
  if (!needsTag) {
    return;
  }
  const x = Math.round(agent.position.x);
  const y = Math.round(agent.position.y) - 3;
  if (y <= 0) {
    return;
  }
  const label = tagLabel(agent);
  const candidates = [
    { x: Math.max(1, x - Math.floor(label.length / 2)), y },
    { x: x + 3, y: y + 1 },
    { x: Math.max(1, x - label.length - 3), y: y + 1 },
    { x: Math.max(1, x - Math.floor(label.length / 2)), y: y - 1 },
  ];
  for (const candidate of candidates) {
    if (canPlaceSoft(grid, candidate.x, candidate.y, label)) {
      drawText(grid, candidate.x, candidate.y, label, agent.color || 'white');
      return;
    }
  }
}

function tagLabel(agent) {
  const badge = toolBadge(agent);
  if (agent.action === 'coffee') {
    return badge;
  }
  if (agent.action === 'toBreak') {
    return `${badge} >`;
  }
  if (agent.action === 'returning') {
    return `${badge} <`;
  }
  if (agent.action === 'leaving') {
    return `${badge} bye`;
  }
  if (agent.action === 'entering') {
    return `${badge} new`;
  }
  return badge;
}

function drawSelection(grid, agent) {
  const x = Math.round(agent.position.x);
  const y = Math.round(agent.position.y);
  drawTextIfBlank(grid, x - 4, y - 2, '.', 'yellow');
  drawTextIfBlank(grid, x + 4, y - 2, '.', 'yellow');
  drawTextIfBlank(grid, x - 4, y + 2, '.', 'yellow');
  drawTextIfBlank(grid, x + 4, y + 2, '.', 'yellow');
}

function drawRoster(grid, agents, hiddenCount = 0) {
  if (!agents.length || grid.length < 8) {
    return;
  }
  const y = grid.length - 2;
  let x = 2;
  const maxX = grid[0].length - 3;
  drawText(grid, x, y, 'agents', 'white');
  x += 7;
  let drawn = 0;
  const rosterAgents = agents.slice().sort((a, b) => a.deskIndex - b.deskIndex);
  for (const agent of rosterAgents) {
    const label = `${toolBadge(agent)} ${shortSession(agent, 11)} ${actionShort(agent)}`;
    const segment = `[${label}]`;
    if (x + segment.length >= maxX) {
      break;
    }
    drawText(grid, x, y, segment, agent.color || 'white');
    x += segment.length + 1;
    drawn += 1;
  }
  const remaining = Math.max(0, rosterAgents.length - drawn) + hiddenCount;
  if (remaining > 0 && x + 4 < maxX) {
    drawText(grid, x, y, `+${remaining}`, 'yellow');
  }
}

function actionShort(agent) {
  if (agent.action === 'coffee') {
    return 'cup';
  }
  if (agent.action === 'toBreak') {
    return 'walk';
  }
  if (agent.action === 'returning') {
    return 'back';
  }
  if (agent.action === 'leaving') {
    return 'bye';
  }
  if (agent.action === 'entering') {
    return 'new';
  }
  if (agent.status === 'idle') {
    return 'idle';
  }
  return 'work';
}


function drawPath(grid, path, color) {
  if (!path || path.length < 2) {
    return;
  }
  const step = Math.max(1, Math.floor(path.length / 30));
  for (let index = 1; index < path.length - 1; index += step) {
    if (path[index].y >= grid.length - 3) {
      continue;
    }
    drawTextIfBlank(grid, path[index].x, path[index].y, '.', color);
  }
}

function drawWindows(grid, layout, now = Date.now()) {
  if (layout.width < 72 || layout.height < 18) {
    return;
  }
  const endX = Math.min(layout.breakRoom.x - 4, layout.width - 18);
  if (endX <= 18) {
    return;
  }
  const cloud = windowCloud(now);
  drawTextIfBlank(grid, 18, 2, `[${cloud}]`, 'cyan');
  if (endX > 32) {
    drawTextIfBlank(grid, 32, 2, `[${windowCloud(now + 500)}]`, 'cyan');
  }
  if (layout.width >= 112 && endX > 52) {
    drawTextIfBlank(grid, 50, 2, `[${windowCloud(now + 1000)}]`, 'cyan');
  }
}

function windowCloud(now) {
  const frames = ['..   ', ' ..  ', '  .. ', '   ..', '  .. ', ' ..  '];
  return frames[Math.floor(now / 700) % frames.length];
}

function drawCoffeeSteam(grid, room, now) {
  if (room.h < 7) {
    return;
  }
  const frames = [' . ', " ' ", ' . ', '   '];
  const steam = frames[Math.floor(now / 320) % frames.length];
  const x = room.x + Math.min(room.w - 7, 5);
  const y = room.y + (room.h >= 8 ? 3 : 2);
  drawTextIfSoft(grid, x, y, steam, 'gray');
}

function drawReceptionCue(grid, layout) {
  if (layout.width < 110 || layout.height < 32) {
    return;
  }
  const lowestDeskBottom = layout.desks.reduce((bottom, desk) => Math.max(bottom, desk.y + desk.h - 1), 0);
  const y = Math.max(4, layout.entrance.y - 5);
  if (y <= lowestDeskBottom + 1) {
    return;
  }
  drawText(grid, 3, y, 'front desk', 'white');
  drawText(grid, 3, y + 1, '[====]', 'gray');
}

function drawAisleRug(grid, startX, y, endX) {
  if (y < 3 || y >= grid.length - 3) {
    return;
  }
  for (let x = startX; x <= endX - 3; x += 14) {
    drawTextIfBlank(grid, x, y, '...', 'gray');
  }
}

function drawCarpetLine(grid, startX, y, endX) {
  if (y < 2 || y >= grid.length - 2) {
    return;
  }
  for (let x = startX; x <= endX; x += 12) {
    drawTextIfBlank(grid, x, y, '.', 'gray');
  }
}

function drawCarpetColumn(grid, x, startY, endY) {
  for (let y = startY; y <= endY; y += 2) {
    drawTextIfBlank(grid, x, y, '.', 'gray');
  }
}

function drawPlant(grid, layout) {
  if (layout.tier !== 'wide' || layout.height < 32) {
    return;
  }
  const x = Math.max(2, Math.min(layout.width - 8, layout.breakRoom.x - 8));
  const y = Math.max(4, layout.breakRoom.y + layout.breakRoom.h + 1);
  drawTextIfBlank(grid, x, y, '(*)', 'green');
  drawTextIfBlank(grid, x, y + 1, '[_]', 'green');
}

function drawChair(grid, desk, agent) {
  const chair = desk.zones?.chair;
  if (!chair) {
    return;
  }
  const color = agent?.selected ? 'yellow' : 'gray';
  if (agent?.action === 'working') {
    return;
  }
  drawText(grid, chair.x - 1, chair.y, '[_]', color);
}

function deskIdentity(agent) {
  if (!agent) {
    return '';
  }
  return `${toolBadge(agent)} ${shortSession(agent, 7)}`;
}

function toolBadge(agent) {
  const key = String(agent?.toolKey || agent?.toolName || '').toLowerCase();
  if (key.includes('codex')) {
    return 'Cx';
  }
  if (key.includes('claude')) {
    return 'Cl';
  }
  if (key.includes('cursor')) {
    return 'Cu';
  }
  if (key.includes('aider')) {
    return 'Ai';
  }
  if (key.includes('gemini')) {
    return 'Gm';
  }
  if (key.includes('unknown')) {
    return '??';
  }
  const words = String(agent?.toolName || agent?.toolKey || 'AI')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.slice(0, 2);
  }
  return (words[0] || 'AI').slice(0, 2).padEnd(2, '?');
}

function shortSession(agent, maxLength) {
  const raw = agent?.sessionName
    || basename(agent?.projectLabel)
    || basename(agent?.projectPath)
    || agent?.toolName
    || 'session';
  const cleaned = String(raw)
    .replace(/^~?\/*(Users\/[^/]+\/)?/, '')
    .replace(/^work\//, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (!cleaned) {
    return 'session'.slice(0, maxLength);
  }
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  const firstMeaningfulPart = cleaned.split(/[-_.]/).find((part) => part.length >= 2);
  if (firstMeaningfulPart && firstMeaningfulPart.length <= maxLength) {
    return firstMeaningfulPart;
  }
  return cleaned.slice(0, maxLength);
}

function basename(value) {
  if (!value) {
    return '';
  }
  return String(value).split('/').filter(Boolean).pop() || String(value);
}

function fitCell(value, width) {
  return String(value || '').slice(0, width).padEnd(width, ' ');
}

function monitorLine(agent, now) {
  if (!agent) {
    return '==[--]';
  }
  if (agent.action === 'coffee' || agent.action === 'toBreak') {
    return '==[--]';
  }
  const elapsed = Math.max(0, now - (agent.actionStartedAt || now));
  const cursor = Math.floor(elapsed / 300) % 2 === 0 ? ':' : '.';
  return `==[${['..', '::', '==', '..'][Math.floor(elapsed / 180) % 4]}] ${cursor}`;
}

function deskStatus(agent) {
  if (!agent) {
    return '';
  }
  if (agent.action === 'coffee') {
    return 'coffee';
  }
  if (agent.action === 'toBreak') {
    return 'to cafe';
  }
  if (agent.action === 'returning') {
    return 'back';
  }
  if (agent.action === 'leaving') {
    return 'leaving';
  }
  if (agent.action === 'entering') {
    return 'arriving';
  }
  return agent.status === 'starting' ? 'starting' : 'typing';
}

function drawRoomWithDoor(grid, room, title, color) {
  const right = room.x + room.w - 1;
  const bottom = room.y + room.h - 1;
  const doorY = room.door.y;

  drawText(grid, room.x, room.y, '+', color);
  drawText(grid, right, room.y, '+', color);
  drawText(grid, room.x, bottom, '+', color);
  drawText(grid, right, bottom, '+', color);
  for (let x = room.x + 1; x < right; x += 1) {
    drawText(grid, x, room.y, '-', color);
    drawText(grid, x, bottom, '-', color);
  }
  for (let y = room.y + 1; y < bottom; y += 1) {
    if (y !== doorY) {
      drawText(grid, room.x, y, '|', color);
    }
    drawText(grid, right, y, '|', color);
  }
  drawText(grid, room.x + 2, room.y, truncate(title, Math.max(0, room.w - 4)), color);
}

function makeGrid(width, height) {
  return Array.from({ length: height }, () => (
    Array.from({ length: width }, () => ({ ch: ' ', color: undefined }))
  ));
}

function drawBorder(grid, x, y, width, height, title, color) {
  if (width < 2 || height < 2) {
    return;
  }
  const right = x + width - 1;
  const bottom = y + height - 1;
  drawText(grid, x, y, '+', color);
  drawText(grid, right, y, '+', color);
  drawText(grid, x, bottom, '+', color);
  drawText(grid, right, bottom, '+', color);
  for (let col = x + 1; col < right; col += 1) {
    drawText(grid, col, y, '-', color);
    drawText(grid, col, bottom, '-', color);
  }
  for (let row = y + 1; row < bottom; row += 1) {
    drawText(grid, x, row, '|', color);
    drawText(grid, right, row, '|', color);
  }
  if (title) {
    drawText(grid, x + 2, y, truncate(title, Math.max(0, width - 4)), color);
  }
}

function drawText(grid, x, y, text, color) {
  if (y < 0 || y >= grid.length) {
    return;
  }
  const row = grid[y];
  for (let index = 0; index < String(text).length; index += 1) {
    const col = x + index;
    if (col < 0 || col >= row.length) {
      continue;
    }
    row[col] = { ch: String(text)[index], color };
  }
}

function drawTextIfBlank(grid, x, y, text, color) {
  if (y < 0 || y >= grid.length) {
    return;
  }
  const row = grid[y];
  for (let index = 0; index < String(text).length; index += 1) {
    const col = x + index;
    if (col < 0 || col >= row.length || row[col].ch !== ' ') {
      continue;
    }
    row[col] = { ch: String(text)[index], color };
  }
}

function drawTextIfSoft(grid, x, y, text, color) {
  if (!canPlaceSoft(grid, x, y, text)) {
    return;
  }
  drawText(grid, x, y, text, color);
}

function canPlaceSoft(grid, x, y, text) {
  if (y < 0 || y >= grid.length) {
    return false;
  }
  const row = grid[y];
  for (let index = 0; index < String(text).length; index += 1) {
    const col = x + index;
    if (col < 0 || col >= row.length) {
      return false;
    }
    if (![' ', '.', ':', "'", '`'].includes(row[col].ch)) {
      return false;
    }
  }
  return true;
}

function drawSpriteCentered(grid, centerX, centerY, lines, colors = {}) {
  const height = lines.length;
  const width = Math.max(...lines.map((line) => String(line).length));
  const startX = centerX - Math.floor(width / 2);
  const startY = centerY - Math.floor(height / 2);
  lines.forEach((line, row) => {
    String(line).split('').forEach((ch, col) => {
      if (ch !== ' ') {
        const color = ch === 'o' ? colors.headColor : colors.bodyColor;
        drawText(grid, startX + col, startY + row, ch, color);
      }
    });
  });
}

function gridToBlessed(grid) {
  return grid.map((row) => {
    let line = '';
    let activeColor;
    for (const cell of row) {
      if (cell.color !== activeColor) {
        if (activeColor) {
          line += '{/}';
        }
        activeColor = cell.color;
        if (activeColor) {
          line += `{${activeColor}-fg}`;
        }
      }
      line += escapeTag(cell.ch);
    }
    if (activeColor) {
      line += '{/}';
    }
    return line;
  }).join('\n');
}

function escapeTag(value) {
  return String(value).replace(/[{}]/g, '');
}

function pointInRect(x, y, rect) {
  return x >= rect.x - 1 && x < rect.x + rect.w + 1 && y >= rect.y - 1 && y < rect.y + rect.h + 1;
}

module.exports = {
  computeDesks,
  renderDetails,
  renderFooter,
  renderHelp,
  renderOffice,
};
