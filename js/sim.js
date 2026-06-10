// ============================================================================
//  sim.js — The Dining Philosophers simulation engine.
//
//  This file is PURE LOGIC. It knows nothing about the DOM, SVG, or pixels.
//  It models N philosophers seated around a round table with N forks between
//  them. A philosopher needs BOTH the fork on their left and the fork on their
//  right to eat. The whole drama of locks / mutexes / deadlock lives here.
//
//  Fork ownership convention (kept consistent with render.js):
//    - philosopher i's LEFT  fork = fork[i]
//    - philosopher i's RIGHT fork = fork[(i + 1) % N]
//    => fork[j] is shared by philosopher j (as left) and philosopher j-1 (as right)
// ============================================================================

export const STRATEGIES = {
  naive: {
    key: 'naive',
    name: 'Naïve',
    tagline: 'Grab left, then right',
    kid: "Everyone grabs the fork on their left, then reaches for the right one. If they all grab left at the SAME time… nobody can ever eat. That stuck-forever moment is a DEADLOCK.",
    tech: 'Each philosopher locks its left fork, then its right. Symmetric ordering allows a circular wait — the textbook deadlock.',
    safe: false,
  },
  hierarchy: {
    key: 'hierarchy',
    name: 'Fork Order',
    tagline: 'Always grab the lower-numbered fork first',
    kid: "We number the forks. Everyone must pick up the smaller-numbered fork first. This one little rule means the circle can never get fully stuck — somebody can always eat!",
    tech: 'Resource hierarchy: forks are totally ordered; each philosopher acquires the lower-numbered fork first. This breaks the circular-wait condition, so deadlock is impossible.',
    safe: true,
  },
  waiter: {
    key: 'waiter',
    name: 'The Waiter',
    tagline: 'Ask the waiter before grabbing forks',
    kid: "A waiter watches the table. You may only pick up forks when the waiter says OK — and only if BOTH your forks are free. So you never grab one fork and get stuck holding it.",
    tech: 'Arbitrator: a single mutex (the waiter) serializes pickup. A philosopher acquires both forks atomically under the waiter lock, or none — so it never holds one while waiting.',
    safe: true,
  },
  semaphore: {
    key: 'semaphore',
    name: 'Limited Seats',
    tagline: 'At most N−1 may try at once',
    kid: "There's one fewer seat than philosophers. With at least one person sitting out, there's always a gap in the circle — so the table can never lock up completely.",
    tech: 'Counting semaphore with N−1 permits. With at most N−1 philosophers competing, a full circular wait is impossible, so deadlock cannot occur.',
    safe: true,
  },
};

// A small, fixed cast so philosophers feel like characters, not indices.
const CAST = [
  { name: 'Plato',     emoji: '🧔🏽' },
  { name: 'Ada',       emoji: '👩🏻' },
  { name: 'Confucius', emoji: '🧑🏻‍🦳' },
  { name: 'Hypatia',   emoji: '👩🏼‍🦰' },
  { name: 'Turing',    emoji: '🧑🏼' },
  { name: 'Simone',    emoji: '👩🏾' },
  { name: 'Laozi',     emoji: '🧓🏻' },
];

// Display state buckets (drive colours & faces in the renderer).
export const PSTATE = {
  THINKING: 'thinking',  // happily pondering, no forks needed
  HUNGRY:   'hungry',    // wants to eat, no forks yet
  WAITING:  'waiting',   // holding a fork (or seat/waiter), blocked on the next
  EATING:   'eating',    // got both forks — nom nom
};

let _eventSeq = 0;

export class Simulation {
  constructor(config = {}) {
    this.reset(config);
  }

  reset(config = {}) {
    this.n          = config.n          ?? this.n          ?? 5;
    this.strategy   = config.strategy   ?? this.strategy   ?? 'naive';
    this.thinkTime  = config.thinkTime  ?? this.thinkTime  ?? 3;
    this.eatTime    = config.eatTime    ?? this.eatTime    ?? 3;
    // When false, philosophers never get hungry on their own — they only
    // start reaching for forks when the user clicks them. Great for staging
    // a deadlock by hand.
    this.autoHunger = config.autoHunger ?? this.autoHunger ?? true;

    this.tick = 0;
    this.deadlock = false;
    this.deadlockCycle = [];   // philosopher ids forming the stuck circle
    this.events = [];

    // Forks: owner is a philosopher id or null when free.
    this.forks = Array.from({ length: this.n }, (_, id) => ({ id, owner: null }));

    // Philosophers.
    this.phils = Array.from({ length: this.n }, (_, id) => {
      const c = CAST[id % CAST.length];
      return {
        id,
        name: c.name,
        emoji: c.emoji,
        phase: 'think',          // 'think' | 'acquire' | 'eat'
        // Stagger the FIRST hunger wave by index so philosophers don't all
        // reach for forks on the same tick — they eat happily for a while
        // before the unlucky alignment finally causes a deadlock (in naive).
        timer: this._rand(this.thinkTime) + id,
        held: [],                // fork ids currently held
        hasSeat: false,          // semaphore strategy
        blockedOn: null,         // { kind:'fork'|'seat'|'waiter', id? } or null
        meals: 0,
        waitTicks: 0,
        message: 'Thinking deep thoughts…',
      };
    });

    // Shared resources for the safe strategies.
    this.waiterOwner = null;            // philosopher id holding the waiter, or null
    this.seatsFree = Math.max(1, this.n - 1); // semaphore permits

    this._emit('system', `Seated ${this.n} philosophers with the “${STRATEGIES[this.strategy].name}” rule.`);
    return this;
  }

  // Randomised duration around a base so philosophers fall out of lockstep.
  _rand(base) {
    // base ticks, plus 0..2 jitter. Pseudo-random but seeded only by sequence
    // (Math.random is fine here — purely cosmetic timing).
    return Math.max(1, base + Math.floor(Math.random() * 3));
  }

  _emit(kind, text, who = null) {
    this.events.push({ id: ++_eventSeq, tick: this.tick, kind, text, who });
    if (this.events.length > 200) this.events.shift();
  }

  // Derived display state for a philosopher.
  displayState(p) {
    if (p.phase === 'eat') return PSTATE.EATING;
    if (p.phase === 'think') return PSTATE.THINKING;
    // acquiring:
    if (p.held.length > 0 || p.hasSeat || this.waiterOwner === p.id) return PSTATE.WAITING;
    return PSTATE.HUNGRY;
  }

  leftFork(id)  { return id; }
  rightFork(id) { return (id + 1) % this.n; }

  // ----- manual interaction -------------------------------------------------

  // Make a thinking philosopher hungry right now (used in manual mode & clicks).
  makeHungry(id) {
    const p = this.phils[id];
    if (p.phase === 'think') {
      p.phase = 'acquire';
      p.timer = 0;
      p.message = 'I’m hungry! Time to grab some forks.';
      this._emit('hungry', `${p.name} is hungry and reaches for forks.`, id);
    }
  }

  // Force the classic textbook deadlock: every philosopher simultaneously
  // grabs their LEFT fork (all distinct, so all succeed), then each is left
  // waiting on a neighbour's fork → a perfect circular wait.
  triggerClassicDeadlock() {
    if (this.strategy !== 'naive') return false;
    // Release everything and reset to a clean simultaneous grab.
    for (const f of this.forks) f.owner = null;
    for (const p of this.phils) {
      p.phase = 'acquire';
      p.held = [];
      p.hasSeat = false;
      p.blockedOn = null;
      p.timer = 0;
    }
    // Lockstep: everyone takes their own (distinct) left fork.
    for (const p of this.phils) {
      const lf = this.leftFork(p.id);
      this.forks[lf].owner = p.id;
      p.held = [lf];
      p.message = 'Got my left fork… now I need the right one.';
    }
    this._emit('warn', 'Everyone grabbed their LEFT fork at the same instant…', null);
    return true;
  }

  // ----- the main step ------------------------------------------------------

  step() {
    if (this.deadlock) return; // frozen until reset/resolved
    this.tick++;

    // Process philosophers in a shuffled order each tick so races are fair and
    // natural deadlocks can emerge in naive mode.
    const order = this._shuffledIds();

    for (const id of order) {
      const p = this.phils[id];
      switch (p.phase) {
        case 'think':  this._stepThinking(p); break;
        case 'acquire': this._stepAcquire(p); break;
        case 'eat':    this._stepEating(p);  break;
      }
    }

    this._detectDeadlock();
  }

  _shuffledIds() {
    const a = this.phils.map(p => p.id);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  _stepThinking(p) {
    if (!this.autoHunger) {           // manual mode: wait to be clicked
      p.message = 'Thinking… (click me when I should eat)';
      return;
    }
    p.timer--;
    if (p.timer <= 0) {
      p.phase = 'acquire';
      p.blockedOn = null;
      p.message = 'I’m hungry! Time to grab some forks.';
      this._emit('hungry', `${p.name} is hungry.`, p.id);
    }
  }

  _stepEating(p) {
    p.timer--;
    if (p.timer <= 0) {
      // Put down both forks.
      for (const fid of p.held) this.forks[fid].owner = null;
      const dropped = [...p.held];
      p.held = [];
      // Release seat if held (semaphore strategy).
      if (p.hasSeat) { p.hasSeat = false; this.seatsFree++; }
      p.phase = 'think';
      p.timer = this._rand(this.thinkTime);
      p.blockedOn = null;
      p.message = 'Mmm, that was good. Back to thinking.';
      this._emit('done', `${p.name} finished eating and put down forks ${dropped.join(' & ')}.`, p.id);
    }
  }

  // Try to grab a free fork. Returns true if grabbed (or already held).
  _grab(p, fid) {
    if (this.forks[fid].owner === p.id) return true;
    if (this.forks[fid].owner === null) {
      this.forks[fid].owner = p.id;
      p.held.push(fid);
      this._emit('grab', `${p.name} picks up fork ${fid}.`, p.id);
      return true;
    }
    return false;
  }

  _startEating(p) {
    p.phase = 'eat';
    p.timer = this._rand(this.eatTime);
    p.blockedOn = null;
    p.meals++;
    p.message = 'Got both forks — eating! 🍝';
    this._emit('eat', `${p.name} has both forks and starts eating.`, p.id);
  }

  _stepAcquire(p) {
    switch (this.strategy) {
      case 'naive':     this._acquireOrdered(p, this.leftFork(p.id), this.rightFork(p.id)); break;
      case 'hierarchy': {
        const l = this.leftFork(p.id), r = this.rightFork(p.id);
        const lo = Math.min(l, r), hi = Math.max(l, r);
        this._acquireOrdered(p, lo, hi);
        break;
      }
      case 'waiter':    this._acquireWaiter(p); break;
      case 'semaphore': this._acquireSemaphore(p); break;
    }
  }

  // Grab `first`, then `second`. Holds `first` while waiting for `second` —
  // this "hold and wait" is exactly what enables deadlock in the naive case,
  // and what the fork-ordering rule tames in the hierarchy case.
  _acquireOrdered(p, first, second) {
    if (!p.held.includes(first)) {
      if (this._grab(p, first)) {
        p.blockedOn = null;
        p.message = `Got fork ${first}. Now I need fork ${second}.`;
      } else {
        p.blockedOn = { kind: 'fork', id: first };
        p.waitTicks++;
        p.message = `Waiting for fork ${first}…`;
      }
      return;
    }
    if (!p.held.includes(second)) {
      if (this._grab(p, second)) {
        this._startEating(p);
      } else {
        p.blockedOn = { kind: 'fork', id: second };
        p.waitTicks++;
        p.message = `Holding fork ${first}, stuck waiting for fork ${second}…`;
      }
      return;
    }
    // Already have both (shouldn't usually reach here).
    this._startEating(p);
  }

  // Single waiter mutex. A philosopher acquires the waiter, and only proceeds
  // if BOTH forks are free at that instant — grabbing both atomically. Otherwise
  // it immediately releases the waiter and tries again later. No "hold one and
  // wait" ever happens, so deadlock is impossible.
  _acquireWaiter(p) {
    const l = this.leftFork(p.id), r = this.rightFork(p.id);
    if (this.waiterOwner !== null && this.waiterOwner !== p.id) {
      p.blockedOn = { kind: 'waiter' };
      p.waitTicks++;
      p.message = 'Waiting for the waiter’s OK…';
      return;
    }
    // We hold (or just took) the waiter.
    this.waiterOwner = p.id;
    const bothFree = this.forks[l].owner === null && this.forks[r].owner === null;
    if (bothFree) {
      this._grab(p, l);
      this._grab(p, r);
      this.waiterOwner = null; // release the waiter immediately
      this._startEating(p);
    } else {
      // Can't get both — step aside so others can be served.
      this.waiterOwner = null;
      p.blockedOn = { kind: 'fork', id: this.forks[l].owner === null ? r : l };
      p.waitTicks++;
      p.message = 'Waiter says: not both forks free yet. I’ll wait.';
    }
  }

  // Counting semaphore: at most N-1 seated. Once seated, behave naively
  // (left then right) — but the missing seat guarantees no full circle.
  _acquireSemaphore(p) {
    if (!p.hasSeat) {
      if (this.seatsFree > 0) {
        this.seatsFree--;
        p.hasSeat = true;
        p.blockedOn = null;
        this._emit('seat', `${p.name} takes a seat (${this.seatsFree} left).`, p.id);
        p.message = 'Got a seat! Now for the forks.';
      } else {
        p.blockedOn = { kind: 'seat' };
        p.waitTicks++;
        p.message = 'All seats taken — waiting for one to open.';
        return;
      }
    }
    this._acquireOrdered(p, this.leftFork(p.id), this.rightFork(p.id));
  }

  // ----- deadlock detection -------------------------------------------------

  // Build the wait-for graph (philosopher -> owner of the fork it's blocked on)
  // and look for a cycle. A cycle of waiting philosophers == deadlock.
  _detectDeadlock() {
    // Only fork-waits create the classic deadlock cycle.
    const waitsFor = new Map(); // pid -> pid it is waiting on
    for (const p of this.phils) {
      if (p.phase === 'acquire' && p.blockedOn && p.blockedOn.kind === 'fork') {
        const owner = this.forks[p.blockedOn.id].owner;
        if (owner !== null && owner !== p.id) waitsFor.set(p.id, owner);
      }
    }
    // Find a cycle via iterative following with visited colouring.
    const cycle = this._findCycle(waitsFor);
    if (cycle && cycle.length) {
      this.deadlock = true;
      this.deadlockCycle = cycle;
      for (const id of cycle) this.phils[id].message = 'Stuck! Can’t get my other fork. 😵';
      this._emit('deadlock', `DEADLOCK! ${cycle.map(i => this.phils[i].name).join(' → ')} → (back to start). Everyone is waiting on someone who will never let go.`, null);
    }
  }

  _findCycle(graph) {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    for (const k of graph.keys()) color.set(k, WHITE);
    let found = null;

    const visit = (start) => {
      const stack = [start];
      const path = [];
      const onPath = new Set();
      while (stack.length) {
        const node = stack[stack.length - 1];
        if (!onPath.has(node)) {
          color.set(node, GRAY);
          onPath.add(node);
          path.push(node);
        }
        const next = graph.get(node);
        if (next === undefined) { // dead end
          onPath.delete(node); path.pop(); stack.pop();
          color.set(node, BLACK);
          continue;
        }
        if (onPath.has(next)) {
          // Found a cycle: slice path from `next` to end.
          const idx = path.indexOf(next);
          found = path.slice(idx);
          return true;
        }
        if (color.get(next) === BLACK) {
          onPath.delete(node); path.pop(); stack.pop();
          color.set(node, BLACK);
          continue;
        }
        stack.push(next);
      }
      return false;
    };

    for (const k of graph.keys()) {
      if (color.get(k) === WHITE) {
        if (visit(k)) break;
      }
    }
    return found;
  }

  // Break a deadlock for teaching: the philosopher who has waited longest puts
  // their fork back down, letting a neighbour proceed.
  resolveDeadlock() {
    if (!this.deadlock) return;
    // Pick the philosopher in the cycle holding a fork; have them release it.
    const victimId = this.deadlockCycle[0];
    const victim = this.phils[victimId];
    for (const fid of victim.held) this.forks[fid].owner = null;
    const dropped = [...victim.held];
    victim.held = [];
    victim.phase = 'think';
    victim.timer = this._rand(this.thinkTime);
    victim.blockedOn = null;
    victim.message = 'Okay, I’ll put my fork down so someone else can eat.';
    this.deadlock = false;
    this.deadlockCycle = [];
    this._emit('resolve', `${victim.name} politely puts down fork(s) ${dropped.join(' & ')} — the jam clears!`, victimId);
  }

  // Snapshot for the renderer (cheap, called every frame).
  snapshot() {
    return {
      n: this.n,
      tick: this.tick,
      strategy: this.strategy,
      deadlock: this.deadlock,
      deadlockCycle: this.deadlockCycle,
      seatsFree: this.seatsFree,
      waiterOwner: this.waiterOwner,
      forks: this.forks.map(f => ({ ...f })),
      phils: this.phils.map(p => ({
        ...p,
        held: [...p.held],
        display: this.displayState(p),
      })),
      totalMeals: this.phils.reduce((s, p) => s + p.meals, 0),
    };
  }
}
