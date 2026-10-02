// Animation time stops on pause. Live metrics and discovery use wall time.
class AnimationClock {
  constructor(now = Date.now()) {
    this.offset = 0;
    this.paused = false;
    this.pausedAt = now;
  }
  time(now = Date.now()) { return (this.paused ? this.pausedAt : now) - this.offset; }
  toggle(now = Date.now()) {
    if (this.paused) this.offset += now - this.pausedAt;
    else this.pausedAt = now;
    this.paused = !this.paused;
  }
}

// Route-based actors retain their position across scans, filters and view changes.
class OfficeScene {
  constructor({ seats, entrance, coffeeSpots, couchSpots, route, initialState, stepMs = 90 }) {
    Object.assign(this, { seats, entrance, coffeeSpots, couchSpots, route, initialState, stepMs });
    this.actors = new Map();
  }

  sync(sessions, now, realNow = now, reducedMotion = false) {
    const ids = new Set(sessions.map((session) => session.id));
    for (const id of this.actors.keys()) if (!ids.has(id)) this.actors.delete(id);
    for (const session of sessions) {
      const index = session.source.deskIndex ?? session.index;
      const seat = this.seats[index % this.seats.length];
      let actor = this.actors.get(session.id);
      if (!actor) {
        const initial = this.initialState(session, seat, realNow, index);
        const stage = initial.state === 'couch' ? 'rest' : ['coffee', 'sip'].includes(initial.state) ? 'coffee' : 'work';
        actor = { ...initial, status: session.status, seat, index, stateAt: now, path: null, stage };
        this.actors.set(session.id, actor);
        if (initial.state === 'walk') this.travel(actor, session.status === 'stopped' ? this.entrance : session.status === 'idle' ? this.coffee(actor) : seat, now, session.status === 'stopped' ? 'exit' : session.status === 'idle' ? 'coffee' : 'work');
      }
      this.advance(actor, now);
      if (actor.status !== session.status) {
        actor.status = session.status;
        this.travel(actor, session.status === 'stopped' ? this.entrance : session.status === 'idle' ? this.coffee(actor) : seat, now, session.status === 'stopped' ? 'exit' : session.status === 'idle' ? 'coffee' : 'work');
      }
      if (reducedMotion) {
        const destination = session.status === 'idle' ? this.couch(actor) : session.status === 'stopped' ? this.entrance : seat;
        Object.assign(actor, destination, { path: null, state: session.status === 'idle' ? 'couch' : session.status === 'stopped' ? 'exit' : 'type', stage: session.status === 'idle' ? 'rest' : 'work', stateAt: now });
      } else if (!actor.path && session.status === 'idle') {
        if (actor.stage === 'work') this.travel(actor, this.coffee(actor), now, 'coffee');
        else if (actor.stage === 'coffee' && now - actor.stateAt >= 2400) this.travel(actor, this.couch(actor), now, 'rest');
        else if (actor.stage === 'rest' && now - actor.stateAt >= 4800) this.travel(actor, this.coffee(actor), now, 'coffee');
        if (!actor.path) actor.state = actor.stage === 'rest' ? 'couch' : now - actor.stateAt > 1000 ? 'sip' : 'coffee';
      } else if (!actor.path && session.status !== 'stopped') {
        actor.state = (now - actor.stateAt + index * 700) % 7200 > 6000 ? 'think' : 'type';
      }
    }
    return sessions.map((session) => ({ ...session, ...this.actors.get(session.id), idNumber: session.source.deskIndex ?? session.index }));
  }

  coffee(actor) { return this.coffeeSpots[actor.index % this.coffeeSpots.length]; }
  couch(actor) { return this.couchSpots[actor.index % this.couchSpots.length]; }

  travel(actor, destination, now, stage) {
    actor.path = this.route({ x: actor.x, y: actor.y }, destination);
    actor.moveAt = now;
    actor.stage = stage;
    actor.state = 'walk';
  }

  advance(actor, now) {
    if (!actor.path) return;
    const step = Math.min(actor.path.length - 1, Math.floor(Math.max(0, now - actor.moveAt) / this.stepMs));
    const point = actor.path[step];
    const next = actor.path[Math.min(step + 1, actor.path.length - 1)];
    if (next.x !== point.x) actor.dir = next.x > point.x ? 1 : -1;
    Object.assign(actor, point);
    if (step === actor.path.length - 1) {
      actor.stateAt = actor.moveAt + step * this.stepMs;
      actor.path = null;
      actor.state = actor.stage === 'exit' ? 'exit' : actor.stage === 'rest' ? 'couch' : actor.stage === 'coffee' ? 'coffee' : 'type';
    }
  }
}

module.exports = { AnimationClock, OfficeScene };
