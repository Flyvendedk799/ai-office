function computeOfficeLayout(width, height, agentCount) {
  const tier = layoutTier(width, height);
  const breakRoom = computeBreakRoom(width, height, tier);
  const deskSpec = deskSpecForTier(tier);
  const columns = deskSpec.columns;
  const rows = deskSpec.rows;
  const maxCount = agentCount === 0 ? 0 : columns * rows;
  const desks = [];
  const entrance = entranceZone(width, height, deskSpec);

  for (let index = 0; index < maxCount; index += 1) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const desk = {
      index,
      row,
      col,
      facing: row === 0 ? 'down' : 'up',
      x: deskSpec.startX + col * (deskSpec.w + deskSpec.gapX),
      y: deskSpec.rowYs[row] ?? deskSpec.rowYs[deskSpec.rowYs.length - 1],
      w: deskSpec.w,
      h: deskSpec.h,
    };
    desks.push({
      ...desk,
      zones: deskZones(desk),
    });
  }

  const breakSlots = breakRoomSlots(breakRoom);
  const layout = {
    width,
    height,
    tier,
    version: `${tier}:${width}x${height}:${desks.length}`,
    entrance,
    exit: { ...entrance, key: 'exit' },
    mainAisleY: deskSpec.aisleY,
    rosterY: Math.max(2, height - 2),
    floor: {
      left: 1,
      top: 1,
      right: Math.max(1, width - 2),
      bottom: Math.max(1, height - 2),
    },
    breakRoom: {
      ...breakRoom,
      door: { key: 'break-door', x: breakRoom.x, y: breakRoom.y + Math.floor(breakRoom.h / 2), radius: 1 },
      zones: {
        coffeeMachine: { key: 'coffee-machine', x: breakRoom.x + breakRoom.w - 7, y: breakRoom.y + 2, radius: 1 },
        couch: { key: 'couch', x: breakRoom.x + 6, y: breakRoom.y + breakRoom.h - 3, radius: 1 },
        table: { key: 'table', x: breakRoom.x + breakRoom.w - 8, y: breakRoom.y + breakRoom.h - 3, radius: 1 },
        slots: breakSlots,
      },
    },
    desks,
  };

  layout.obstacleKey = obstacleKey(layout);
  return layout;
}

function layoutTier(width, height) {
  if (width >= 120 && height >= 33) {
    return 'wide';
  }
  if (width >= 100 && height >= 27) {
    return 'standard';
  }
  if (width >= 80 && height >= 24) {
    return 'compact';
  }
  if (width >= 80 && height >= 21) {
    return 'short';
  }
  return 'mini';
}

function computeBreakRoom(width, height, tier) {
  const sizes = {
    wide: { w: 30, h: 10 },
    standard: { w: 27, h: 9 },
    compact: { w: 23, h: 8 },
    short: { w: 23, h: 8 },
    mini: { w: 18, h: 7 },
  };
  const size = sizes[tier];
  const w = Math.min(size.w, Math.max(14, width - 14));
  const h = Math.min(size.h, Math.max(5, height - 10));
  return {
    x: Math.max(10, width - w - 3),
    y: tier === 'mini' ? 2 : 3,
    w,
    h,
  };
}

function deskSpecForTier(tier) {
  if (tier === 'wide') {
    return { w: 12, h: 5, gapX: 3, startX: 4, columns: 5, rows: 2, rowYs: [5, 20], aisleY: 15 };
  }
  if (tier === 'standard') {
    return { w: 12, h: 5, gapX: 2, startX: 4, columns: 4, rows: 2, rowYs: [5, 20], aisleY: 15 };
  }
  if (tier === 'compact') {
    return { w: 11, h: 4, gapX: 2, startX: 3, columns: 4, rows: 2, rowYs: [4, 15], aisleY: 12 };
  }
  if (tier === 'short') {
    return { w: 11, h: 4, gapX: 2, startX: 3, columns: 4, rows: 1, rowYs: [4], aisleY: 12 };
  }
  return { w: 11, h: 4, gapX: 2, startX: 3, columns: 3, rows: 1, rowYs: [4], aisleY: 11 };
}

function entranceZone(width, height, deskSpec) {
  const crampedTwoRowOffice = deskSpec.rows > 1 && height < 28;
  return {
    key: 'entrance',
    x: crampedTwoRowOffice ? 7 : Math.min(11, Math.max(5, width - 8)),
    y: crampedTwoRowOffice ? deskSpec.aisleY : Math.max(3, height - 4),
    radius: 2,
  };
}

function deskZones(desk) {
  const centerX = desk.x + Math.floor(desk.w / 2);
  const chairY = desk.facing === 'down'
    ? desk.y + desk.h + 2
    : Math.max(3, desk.y - 3);
  const approachY = desk.facing === 'down'
    ? chairY + 2
    : Math.max(2, chairY - 2);

  return {
    approach: { key: `desk-${desk.index}-approach`, x: centerX, y: approachY, radius: 1 },
    chair: { key: `desk-${desk.index}-chair`, x: centerX, y: chairY, radius: 1 },
    pc: { key: `desk-${desk.index}-pc`, x: desk.x + Math.floor(desk.w / 2), y: desk.y + Math.floor(desk.h / 2), radius: 0 },
  };
}

function breakRoomSlots(room) {
  const yMid = room.y + Math.min(5, Math.max(2, room.h - 4));
  const loungeY = room.y + Math.max(3, room.h - 4);
  const lowerY = loungeY - yMid >= 3 ? loungeY : yMid;
  const leftX = room.x + 6;
  const rightX = room.x + room.w - 8;
  return [
    { key: 'break-slot-0', x: leftX, y: yMid, radius: 2 },
    { key: 'break-slot-1', x: rightX, y: yMid, radius: 2 },
    { key: 'break-slot-2', x: leftX, y: lowerY, radius: 2 },
    { key: 'break-slot-3', x: rightX, y: lowerY, radius: 2 },
    { key: 'break-slot-4', x: room.x + Math.floor(room.w / 2), y: yMid, radius: 2 },
  ];
}

function obstacleKey(layout) {
  return [
    layout.version,
    `${layout.breakRoom.x},${layout.breakRoom.y},${layout.breakRoom.w},${layout.breakRoom.h}`,
    layout.desks.map((desk) => `${desk.x},${desk.y},${desk.w},${desk.h}`).join(';'),
  ].join('|');
}

module.exports = {
  computeOfficeLayout,
  layoutTier,
};
