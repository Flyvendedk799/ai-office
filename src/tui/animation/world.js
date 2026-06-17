const { computeOfficeLayout } = require('./layout');
const { RoutePlanner } = require('./pathfinding');
const { spriteFor } = require('./sprites');

const IDLE_DEBOUNCE_MS = 1200;
const RUN_CELLS_PER_SECOND = 7;
const MINI_RUN_CELLS_PER_SECOND = 6;
const LEAVE_CELLS_PER_SECOND = 8;

class WorldAnimator {
  constructor() {
    this.states = new Map();
    this.planner = new RoutePlanner();
  }

  buildFrame({ agents, width, height, now, selectedId, showDebugRoutes = false }) {
    const layout = computeOfficeLayout(width, height, agents.length);
    const walkGrid = this.planner.buildWalkGrid(layout);
    const visibleAgents = agents.slice(0, layout.desks.length);
    const seen = new Set();
    const animatedAgents = [];

    for (let index = 0; index < visibleAgents.length; index += 1) {
      const agent = visibleAgents[index];
      seen.add(agent.id);
      const animated = this.updateAgent(agent, index, layout, walkGrid, now);
      animated.selected = agent.id === selectedId;
      animated.sprite = spriteFor(animated, now);
      animated.zIndex = Math.round(animated.position.y * 10 + index);
      animatedAgents.push(animated);
    }

    for (const id of [...this.states.keys()]) {
      if (!seen.has(id)) {
        this.states.delete(id);
      }
    }

    animatedAgents.sort((a, b) => a.zIndex - b.zIndex);

    return {
      width,
      height,
      now,
      layout,
      agents: animatedAgents,
      debug: {
        showRoutes: showDebugRoutes,
        paths: showDebugRoutes ? animatedAgents.filter((agent) => !agent.routeDone).map((agent) => agent.route) : [],
        blockedCells: showDebugRoutes ? walkGrid : undefined,
      },
    };
  }

  updateAgent(agent, index, layout, walkGrid, now) {
    const desk = layout.desks[index];
    const zones = zonesFor(agent, index, layout, desk);
    let state = this.states.get(agent.id);

    if (!state) {
      const initial = initialStateFor(agent, zones, now);
      state = {
        id: agent.id,
        action: initial.action,
        previousAction: undefined,
        route: [],
        routeStartedAt: initial.startedAt,
        actionStartedAt: initial.startedAt,
        lastKnownPosition: initial.position,
        targetKey: '',
        idleSeenAt: agent.status === 'idle' ? (agent.statusChangedAt ?? agent.appearAt ?? now) : undefined,
        rawStatus: agent.status,
        deskIndex: index,
        layoutVersion: layout.version,
      };
      this.states.set(agent.id, state);
    }

    state.rawStatus = agent.status;
    state.deskIndex = index;

    let afterTransition = this.visualForState(state, now);
    for (let iteration = 0; iteration < 4; iteration += 1) {
      state.lastKnownPosition = afterTransition.position;
      const desired = desiredAction(agent, state, afterTransition, zones, now);
      ensureRoute(state, desired, zones, layout, walkGrid, this.planner, now);
      afterTransition = this.visualForState(state, now);
      state.lastKnownPosition = afterTransition.position;

      if (state.action === 'entering' && afterTransition.done) {
        startStationary(state, 'working', now, zones.chair);
        afterTransition = this.visualForState(state, now);
        continue;
      }
      if (state.action === 'toBreak' && afterTransition.done) {
        startStationary(state, 'coffee', now, zones.breakSlot);
        afterTransition = this.visualForState(state, now);
        continue;
      }
      if (state.action === 'returning' && afterTransition.done) {
        startStationary(state, 'working', now, zones.chair);
        afterTransition = this.visualForState(state, now);
        continue;
      }
      break;
    }
    state.lastKnownPosition = afterTransition.position;

    return {
      id: agent.id,
      icon: agent.icon,
      toolKey: agent.toolKey,
      toolName: agent.toolName,
      sessionName: agent.sessionName,
      projectLabel: agent.projectLabel,
      projectPath: agent.projectPath,
      status: agent.status,
      deskIndex: index,
      color: agent.status === 'stopped' ? 'white' : (agent.color || 'white'),
      action: state.action,
      previousAction: state.previousAction,
      position: afterTransition.position,
      direction: afterTransition.direction,
      route: state.route,
      routeDone: afterTransition.done,
      routeStartedAt: state.routeStartedAt,
      actionStartedAt: state.actionStartedAt,
      targetKey: state.targetKey,
      zIndex: 0,
    };
  }

  visualForState(state, now) {
    if (!state.route || state.route.length === 0 || isStationaryAction(state.action)) {
      return {
        position: state.lastKnownPosition || { x: 0, y: 0 },
        direction: state.direction || 'down',
        done: true,
      };
    }

    return positionOnRoute(state.route, now - state.routeStartedAt, msPerCellForAction(state.action, state.layoutTier));
  }
}

function initialStateFor(agent, zones, now) {
  const appearedAt = agent.appearAt ?? now;
  const age = Math.max(0, now - appearedAt);
  const statusChangedAt = agent.statusChangedAt ?? appearedAt;
  const statusAge = Math.max(0, now - statusChangedAt);

  if (agent.status === 'stopped') {
    return {
      action: 'leaving',
      position: zones.chair,
      startedAt: agent.stoppedAt ?? statusChangedAt,
    };
  }

  if (agent.status === 'idle' && statusAge >= IDLE_DEBOUNCE_MS + 2000) {
    return {
      action: 'coffee',
      position: zones.breakSlot,
      startedAt: statusChangedAt + IDLE_DEBOUNCE_MS,
    };
  }

  if ((agent.status === 'active' || agent.status === 'idle') && age >= 4500) {
    return {
      action: 'working',
      position: zones.chair,
      startedAt: statusChangedAt,
    };
  }

  return {
    action: 'entering',
    position: zones.entrance,
    startedAt: appearedAt,
  };
}

function desiredAction(agent, state, currentVisual, zones, now) {
  if (agent.status === 'stopped') {
    return {
      action: 'leaving',
      target: zones.exit,
      targetKey: zones.exit.key,
      from: currentVisual.position,
      startedAt: agent.stoppedAt ?? now,
    };
  }

  if (state.action === 'entering' && (!state.route || state.route.length === 0 || !currentVisual.done)) {
    return {
      action: 'entering',
      target: zones.chair,
      targetKey: zones.chair.key,
      from: state.route[0] || zones.entrance,
      startedAt: state.routeStartedAt,
    };
  }

  if (agent.status === 'idle') {
    if (state.idleSeenAt === undefined) {
      state.idleSeenAt = now;
    }
    if (now - state.idleSeenAt < IDLE_DEBOUNCE_MS && !['toBreak', 'coffee'].includes(state.action)) {
      return { action: 'working', target: zones.chair, targetKey: zones.chair.key, from: currentVisual.position };
    }
    if (state.action === 'coffee') {
      return { action: 'coffee', target: zones.breakSlot, targetKey: zones.breakSlot.key, from: currentVisual.position };
    }
    return {
      action: 'toBreak',
      target: zones.breakSlot,
      targetKey: zones.breakSlot.key,
      from: currentVisual.position,
      startedAt: state.idleSeenAt + IDLE_DEBOUNCE_MS,
    };
  }

  state.idleSeenAt = undefined;
  if (['coffee', 'toBreak'].includes(state.action)) {
    return {
      action: 'returning',
      target: zones.chair,
      targetKey: zones.chair.key,
      from: currentVisual.position,
      startedAt: agent.statusChangedAt ?? now,
    };
  }

  if (state.action === 'entering' && currentVisual.done) {
    return { action: 'working', target: zones.chair, targetKey: zones.chair.key, from: currentVisual.position };
  }

  return { action: 'working', target: zones.chair, targetKey: zones.chair.key, from: currentVisual.position };
}

function ensureRoute(state, desired, zones, layout, walkGrid, planner, now) {
  const targetKey = `${layout.version}:${desired.action}:${desired.targetKey}`;
  if (isStationaryAction(desired.action)) {
    if (state.action !== desired.action) {
      startStationary(state, desired.action, now, desired.target);
    }
    state.targetKey = targetKey;
    return;
  }

  const needsNewRoute = state.action !== desired.action
    || state.targetKey !== targetKey
    || state.layoutVersion !== layout.version
    || !state.route
    || state.route.length === 0;

  if (!needsNewRoute) {
    return;
  }

  const from = {
    key: `from-${state.id}`,
    x: Math.round(desired.from?.x ?? state.lastKnownPosition?.x ?? zones.entrance.x),
    y: Math.round(desired.from?.y ?? state.lastKnownPosition?.y ?? zones.entrance.y),
    radius: 1,
  };
  const route = planner.route(layout, walkGrid, from, desired.target);
  const oldAction = state.action;
  const routeStartedAt = desired.startedAt ?? (oldAction === 'entering' && (!state.route || state.route.length === 0)
    ? state.routeStartedAt
    : now);
  state.previousAction = state.action;
  state.action = desired.action;
  state.route = route;
  state.routeStartedAt = routeStartedAt;
  state.actionStartedAt = routeStartedAt;
  state.targetKey = targetKey;
  state.layoutVersion = layout.version;
  state.layoutTier = layout.tier;
}

function startStationary(state, action, now, position) {
  state.previousAction = state.action;
  state.action = action;
  state.route = [];
  state.routeStartedAt = now;
  state.actionStartedAt = now;
  if (position) {
    state.lastKnownPosition = position;
  }
}

function zonesFor(agent, index, layout, desk) {
  const breakSlots = layout.breakRoom.zones.slots;
  return {
    entrance: layout.entrance,
    exit: layout.exit,
    approach: desk.zones.approach,
    chair: desk.zones.chair,
    breakDoor: layout.breakRoom.door,
    breakSlot: breakSlots[index % breakSlots.length],
  };
}

function positionOnRoute(route, elapsedMs, msPerCell) {
  if (!route || route.length === 0) {
    return { position: { x: 0, y: 0 }, direction: 'down', done: true };
  }
  if (route.length === 1) {
    return { position: route[0], direction: 'down', done: true };
  }

  const easedDistance = easedRouteDistance(route.length - 1, Math.max(0, elapsedMs / msPerCell));
  const segment = Math.floor(easedDistance);
  if (segment >= route.length - 1) {
    const last = route[route.length - 1];
    return {
      position: last,
      direction: directionBetween(route[route.length - 2], last),
      done: true,
    };
  }

  const a = route[segment];
  const b = route[segment + 1];
  const t = easedDistance - segment;
  return {
    position: {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    },
    direction: directionBetween(a, b),
    done: false,
  };
}

function easedRouteDistance(totalCells, rawCells) {
  if (totalCells <= 1) {
    return rawCells;
  }
  const t = Math.min(1, rawCells / totalCells);
  const eased = t < 0.18
    ? easeInOut(t / 0.18) * 0.18
    : t > 0.82
      ? 0.82 + easeInOut((t - 0.82) / 0.18) * 0.18
      : t;
  return eased * totalCells;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function msPerCellForAction(action, tier) {
  const cellsPerSecond = action === 'leaving'
    ? LEAVE_CELLS_PER_SECOND
    : tier === 'mini'
      ? MINI_RUN_CELLS_PER_SECOND
      : RUN_CELLS_PER_SECOND;
  return 1000 / cellsPerSecond;
}

function isStationaryAction(action) {
  return ['working', 'coffee', 'thinking'].includes(action);
}

function directionBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? 'left' : 'right';
  }
  if (dy < 0) {
    return 'up';
  }
  return 'down';
}

module.exports = {
  IDLE_DEBOUNCE_MS,
  WorldAnimator,
  positionOnRoute,
};
