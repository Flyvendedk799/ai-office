class RoutePlanner {
  constructor() {
    this.cache = new Map();
  }

  buildWalkGrid(layout) {
    return buildWalkGrid(layout);
  }

  route(layout, walkGrid, from, to, options = {}) {
    const cacheKey = [
      layout.obstacleKey,
      zoneKey(from),
      zoneKey(to),
      (options.avoid || []).map(pointKey).sort().join(';'),
    ].join('|');

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const blocked = cloneGrid(walkGrid);
    for (const point of options.avoid || []) {
      blockAround(blocked, point, 1);
    }
    unblockAround(blocked, from, from.radius ?? 1);
    unblockAround(blocked, to, to.radius ?? 1);

    const start = clampPoint(blocked, from);
    const end = clampPoint(blocked, to);
    let path = start && end ? routeDirect(blocked, start, end) : [from, to];
    if (start && end && routeNeedsBreakDoor(layout, start, end)) {
      const door = clampPoint(blocked, layout.breakRoom.door);
      if (door) {
        const first = routeDirect(blocked, start, door);
        const second = routeDirect(blocked, door, end);
        path = [...first, ...second.slice(1)];
      }
    }
    this.cache.set(cacheKey, path);
    return path;
  }
}

function buildWalkGrid(layout) {
  const blocked = Array.from({ length: layout.height }, () => Array.from({ length: layout.width }, () => false));

  blockRect(blocked, 0, 0, layout.width, 1);
  blockRect(blocked, 0, 0, 1, layout.height);
  blockRect(blocked, layout.width - 1, 0, 1, layout.height);
  blockRect(blocked, 0, layout.height - 1, layout.width, 1);
  blockRect(blocked, 1, 1, layout.width - 2, 1);

  for (const desk of layout.desks) {
    blockRect(blocked, desk.x - 1, desk.y - 1, desk.w + 2, desk.h + 2);
  }

  blockBreakRoom(blocked, layout.breakRoom);

  for (const desk of layout.desks) {
    unblockAround(blocked, desk.zones.approach, 1);
    unblockAround(blocked, desk.zones.chair, 1);
  }
  unblockAround(blocked, layout.entrance, 1);
  unblockAround(blocked, layout.exit, 1);
  unblockAround(blocked, layout.breakRoom.door, 1);
  for (const slot of layout.breakRoom.zones.slots) {
    unblockAround(blocked, slot, 1);
  }

  return blocked;
}

function findAStar(blocked, start, end) {
  const open = [start];
  const openKeys = new Set([pointKey(start)]);
  const cameFrom = new Map();
  const gScore = new Map([[pointKey(start), 0]]);
  const fScore = new Map([[pointKey(start), manhattan(start, end)]]);

  while (open.length > 0) {
    open.sort((a, b) => (fScore.get(pointKey(a)) ?? Infinity) - (fScore.get(pointKey(b)) ?? Infinity));
    const current = open.shift();
    openKeys.delete(pointKey(current));

    if (current.x === end.x && current.y === end.y) {
      return reconstructPath(cameFrom, current);
    }

    for (const next of neighbors(current)) {
      if (isBlocked(blocked, next.x, next.y)) {
        continue;
      }
      const tentative = (gScore.get(pointKey(current)) ?? Infinity) + 1;
      const nextKey = pointKey(next);
      if (tentative >= (gScore.get(nextKey) ?? Infinity)) {
        continue;
      }

      cameFrom.set(nextKey, current);
      gScore.set(nextKey, tentative);
      fScore.set(nextKey, tentative + manhattan(next, end));
      if (!openKeys.has(nextKey)) {
        open.push(next);
        openKeys.add(nextKey);
      }
    }
  }

  return [start, end];
}

function simplifyPath(path) {
  if (!path || path.length <= 2) {
    return path || [];
  }

  const simplified = [path[0]];
  let previousDirection = segmentDirection(path[0], path[1]);
  for (let index = 2; index < path.length; index += 1) {
    const direction = segmentDirection(path[index - 1], path[index]);
    if (direction !== previousDirection) {
      simplified.push(path[index - 1]);
      previousDirection = direction;
    }
  }
  simplified.push(path[path.length - 1]);
  return expandedPath(simplified);
}

function routeDirect(blocked, start, end) {
  return simplifyPath(findAStar(blocked, start, end), blocked);
}

function expandedPath(points) {
  const expanded = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let step = 0; step <= steps; step += 1) {
      const point = {
        x: Math.round(a.x + (dx * step) / Math.max(1, steps)),
        y: Math.round(a.y + (dy * step) / Math.max(1, steps)),
      };
      if (expanded.length === 0 || pointKey(expanded[expanded.length - 1]) !== pointKey(point)) {
        expanded.push(point);
      }
    }
  }
  return expanded.length ? expanded : points;
}

function routeNeedsBreakDoor(layout, start, end) {
  return isInsideRect(start, layout.breakRoom) !== isInsideRect(end, layout.breakRoom);
}

function isInsideRect(point, rect) {
  return point.x > rect.x && point.x < rect.x + rect.w - 1 && point.y > rect.y && point.y < rect.y + rect.h - 1;
}

function segmentDirection(a, b) {
  if (a.x !== b.x) {
    return a.x < b.x ? 'right' : 'left';
  }
  if (a.y !== b.y) {
    return a.y < b.y ? 'down' : 'up';
  }
  return 'still';
}

function blockBreakRoom(blocked, room) {
  for (let x = room.x; x < room.x + room.w; x += 1) {
    setBlocked(blocked, x, room.y, true);
    setBlocked(blocked, x, room.y + room.h - 1, true);
  }
  for (let y = room.y; y < room.y + room.h; y += 1) {
    setBlocked(blocked, room.x, y, true);
    setBlocked(blocked, room.x + room.w - 1, y, true);
  }
  setBlocked(blocked, room.door.x, room.door.y, false);
}

function reconstructPath(cameFrom, end) {
  const path = [end];
  let current = end;
  while (cameFrom.has(pointKey(current))) {
    current = cameFrom.get(pointKey(current));
    path.push(current);
  }
  return path.reverse();
}

function neighbors(point) {
  return [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 },
  ];
}

function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

function blockRect(blocked, x, y, width, height) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      setBlocked(blocked, col, row, true);
    }
  }
}

function blockAround(blocked, point, radius) {
  for (let y = point.y - radius; y <= point.y + radius; y += 1) {
    for (let x = point.x - radius; x <= point.x + radius; x += 1) {
      setBlocked(blocked, x, y, true);
    }
  }
}

function unblockAround(blocked, point, radius) {
  for (let y = point.y - radius; y <= point.y + radius; y += 1) {
    for (let x = point.x - radius; x <= point.x + radius; x += 1) {
      setBlocked(blocked, x, y, false);
    }
  }
}

function setBlocked(blocked, x, y, value) {
  if (y < 0 || y >= blocked.length || x < 0 || x >= blocked[y].length) {
    return;
  }
  blocked[y][x] = value;
}

function isBlocked(blocked, x, y) {
  return y < 0 || y >= blocked.length || x < 0 || x >= blocked[y].length || blocked[y][x];
}

function clampPoint(blocked, point) {
  const x = Math.max(0, Math.min(blocked[0].length - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(blocked.length - 1, Math.round(point.y)));
  if (!isBlocked(blocked, x, y)) {
    return { ...point, x, y };
  }

  for (let radius = 1; radius < 10; radius += 1) {
    for (let row = y - radius; row <= y + radius; row += 1) {
      for (let col = x - radius; col <= x + radius; col += 1) {
        if (!isBlocked(blocked, col, row)) {
          return { ...point, x: col, y: row };
        }
      }
    }
  }
  return null;
}

function pointKey(point) {
  return `${Math.round(point.x)},${Math.round(point.y)}`;
}

function zoneKey(point) {
  return `${point.key || 'p'}:${Math.round(point.x)},${Math.round(point.y)}`;
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

module.exports = {
  RoutePlanner,
  buildWalkGrid,
  findAStar,
  isBlocked,
  manhattan,
  pointKey,
};
