// ============================================================================
//  render.js — draws the simulation snapshot into a hybrid SVG + HTML stage.
//
//  Layout split:
//    • SVG  → candle glow, table ring, forks (animated), deadlock arrows.
//    • HTML → philosopher "cards" (avatar, name, status, thought bubble, meals)
//             positioned with the same 0..800 → 0..100% geometry as the SVG.
//
//  The renderer is rebuilt only when N changes (rebuildLayout). Every frame it
//  just mutates positions / classes / text (update) so motion stays buttery.
// ============================================================================

import { PSTATE, STRATEGIES } from './sim.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const VB = 800;
const C = VB / 2;
const R_PHIL = 286;   // philosopher ring radius
const R_FORK = 196;   // fork rest radius
const R_RING = 232;   // table edge radius

const STATE_LABEL = {
  [PSTATE.THINKING]: 'thinking',
  [PSTATE.HUNGRY]:   'hungry',
  [PSTATE.WAITING]:  'waiting',
  [PSTATE.EATING]:   'eating',
};

function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function div(cls, parent = null) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (parent) parent.appendChild(d);
  return d;
}

// angle (degrees) for philosopher i, with 12 o'clock = top
function philAngle(i, n) { return -90 + i * (360 / n); }
function forkAngle(j, n) { return -90 + (j - 0.5) * (360 / n); }
function polar(angleDeg, r) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
}
function lerp(a, b, t) { return a + (b - a) * t; }

export class Scene {
  constructor(svg, overlay, opts = {}) {
    this.svg = svg;
    this.overlay = overlay;          // HTML container for philosopher cards
    this.onPhilClick = opts.onPhilClick || (() => {});
    this.n = 0;
    this.refs = {};                  // cached element references
  }

  rebuildLayout(n) {
    this.n = n;
    this.svg.setAttribute('viewBox', `0 0 ${VB} ${VB}`);
    this.svg.innerHTML = '';
    this.overlay.innerHTML = '';
    this.refs = { phils: [], forks: [], plates: [], arrows: null };

    // ---- defs: gradients, glows ------------------------------------------
    const defs = el('defs', {}, this.svg);
    defs.innerHTML = `
      <radialGradient id="candle" cx="50%" cy="50%" r="50%">
        <stop offset="0%"  stop-color="rgba(255,196,107,0.55)"/>
        <stop offset="35%" stop-color="rgba(255,150,70,0.18)"/>
        <stop offset="100%" stop-color="rgba(255,150,70,0)"/>
      </radialGradient>
      <radialGradient id="tableFill" cx="50%" cy="42%" r="62%">
        <stop offset="0%"  stop-color="#1a1d2b"/>
        <stop offset="70%" stop-color="#13151f"/>
        <stop offset="100%" stop-color="#0e1018"/>
      </radialGradient>
      <linearGradient id="forkGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#eef1ff"/>
        <stop offset="100%" stop-color="#aeb4d6"/>
      </linearGradient>
      <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="6" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>`;

    // ---- candle glow ------------------------------------------------------
    el('circle', { class: 'candle-glow', cx: C, cy: C, r: 300, fill: 'url(#candle)' }, this.svg);

    // ---- table ------------------------------------------------------------
    el('circle', { class: 'table-fill', cx: C, cy: C, r: R_RING, fill: 'url(#tableFill)' }, this.svg);
    el('circle', { class: 'table-ring', cx: C, cy: C, r: R_RING, fill: 'none' }, this.svg);
    el('circle', { class: 'table-ring-inner', cx: C, cy: C, r: R_RING - 26, fill: 'none' }, this.svg);

    // central candle flame
    const flame = el('g', { class: 'flame' }, this.svg);
    el('ellipse', { cx: C, cy: C + 4, rx: 13, ry: 20, fill: '#ffd27a', filter: 'url(#softGlow)' }, flame);
    el('ellipse', { cx: C, cy: C + 7, rx: 6, ry: 11, fill: '#fff4d6' }, flame);

    // ---- arrows layer (deadlock cycle) -----------------------------------
    this.refs.arrows = el('g', { class: 'arrows' }, this.svg);

    // ---- plates + forks (SVG) --------------------------------------------
    for (let i = 0; i < n; i++) {
      const p = polar(philAngle(i, n), R_PHIL * 0.62);
      const plate = el('ellipse', { class: 'plate', cx: p.x, cy: p.y, rx: 34, ry: 17 }, this.svg);
      this.refs.plates.push(plate);
    }
    for (let j = 0; j < n; j++) {
      const g = el('g', { class: 'fork-group' }, this.svg);
      // fork glyph centered at origin (points "up"); ~ 12 wide, 64 tall
      g.innerHTML = `
        <g class="fork-glyph">
          <rect x="-1.6" y="-30" width="3.2" height="34" rx="1.6"/>
          <rect x="-9"  y="-30" width="2.6" height="15" rx="1.3"/>
          <rect x="-3"  y="-32" width="2.6" height="17" rx="1.3"/>
          <rect x="3"   y="-32" width="2.6" height="17" rx="1.3"/>
          <rect x="9"   y="-30" width="2.6" height="15" rx="1.3"/>
          <rect x="-6.4" y="-16" width="12.8" height="4" rx="2"/>
          <circle cx="0" cy="8" r="4.4"/>
        </g>`;
      this.refs.forks.push(g);
    }

    // ---- philosopher cards (HTML overlay) --------------------------------
    for (let i = 0; i < n; i++) {
      const pos = polar(philAngle(i, n), R_PHIL);
      const card = div('phil', this.overlay);
      card.style.left = `${(pos.x / VB) * 100}%`;
      card.style.top = `${(pos.y / VB) * 100}%`;
      card.dataset.id = String(i);
      card.innerHTML = `
        <div class="phil__bubble"><span class="phil__bubble-text"></span></div>
        <div class="phil__avatar">
          <div class="phil__ring"></div>
          <div class="phil__face"></div>
          <div class="phil__id"></div>
        </div>
        <div class="phil__name"></div>
        <div class="phil__chip"><span class="phil__chip-dot"></span><span class="phil__chip-text"></span></div>
        <div class="phil__meals" title="meals eaten"></div>`;
      card.addEventListener('click', () => this.onPhilClick(i));
      this.refs.phils.push({
        card,
        bubble: card.querySelector('.phil__bubble'),
        bubbleText: card.querySelector('.phil__bubble-text'),
        face: card.querySelector('.phil__face'),
        idTag: card.querySelector('.phil__id'),
        name: card.querySelector('.phil__name'),
        chip: card.querySelector('.phil__chip'),
        chipText: card.querySelector('.phil__chip-text'),
        meals: card.querySelector('.phil__meals'),
        ring: card.querySelector('.phil__ring'),
      });
    }
  }

  update(snap) {
    if (snap.n !== this.n) this.rebuildLayout(snap.n);
    const n = snap.n;

    // ----- forks -----------------------------------------------------------
    for (let j = 0; j < n; j++) {
      const f = snap.forks[j];
      const g = this.refs.forks[j];
      const rest = polar(forkAngle(j, n), R_FORK);
      let x = rest.x, y = rest.y, rot;
      // base rotation: tines point toward the table centre
      const radialAngle = Math.atan2(C - rest.y, C - rest.x) * 180 / Math.PI;

      if (f.owner !== null) {
        const owner = polar(philAngle(f.owner, n), R_PHIL * 0.78);
        x = lerp(rest.x, owner.x, 0.52);
        y = lerp(rest.y, owner.y, 0.52);
        rot = Math.atan2(C - owner.y, C - owner.x) * 180 / Math.PI - 90 + 12;
        g.classList.add('fork-group--held');
        const col = stateColorVar(snap.phils[f.owner].display);
        g.style.setProperty('--fork-color', col);
      } else {
        rot = radialAngle - 90;
        g.classList.remove('fork-group--held');
        g.style.removeProperty('--fork-color');
      }
      g.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
    }

    // ----- philosophers ----------------------------------------------------
    for (let i = 0; i < n; i++) {
      const p = snap.phils[i];
      const r = this.refs.phils[i];
      const st = p.display;
      r.card.className = `phil phil--${st}`;
      if (snap.deadlock && snap.deadlockCycle.includes(i)) r.card.classList.add('phil--deadlock');
      r.face.textContent = faceFor(st, p.emoji, snap.deadlock && snap.deadlockCycle.includes(i));
      r.idTag.textContent = `P${i}`;
      r.name.textContent = p.name;
      r.chipText.textContent = STATE_LABEL[st];
      r.bubbleText.textContent = shortBubble(p, st, snap);
      r.bubble.classList.toggle('is-shown', st !== PSTATE.THINKING || !!p.held.length);
      // meal pips
      if (r.meals.childElementCount !== Math.min(p.meals, 8)) {
        r.meals.innerHTML = '';
        for (let k = 0; k < Math.min(p.meals, 8); k++) div('pip', r.meals);
      }
      r.meals.dataset.count = p.meals > 8 ? `${p.meals}` : '';
    }

    // ----- deadlock arrows -------------------------------------------------
    this._drawArrows(snap);

    // ----- stage-level deadlock flag --------------------------------------
    this.svg.classList.toggle('is-deadlock', snap.deadlock);
  }

  _drawArrows(snap) {
    const layer = this.refs.arrows;
    layer.innerHTML = '';
    if (!snap.deadlock || !snap.deadlockCycle.length) return;
    const n = snap.n;
    const cyc = snap.deadlockCycle;
    // ensure arrowhead marker exists
    el('path', { class: 'arrow-head-def' }, layer); // placeholder
    for (let k = 0; k < cyc.length; k++) {
      const a = cyc[k];
      const b = cyc[(k + 1) % cyc.length];
      const pa = polar(philAngle(a, n), R_PHIL * 0.74);
      const pb = polar(philAngle(b, n), R_PHIL * 0.74);
      // curved arc through a point pulled toward centre
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      const cx = lerp(mx, C, 0.32), cy = lerp(my, C, 0.32);
      const path = el('path', {
        class: 'dl-arrow',
        d: `M ${pa.x} ${pa.y} Q ${cx} ${cy} ${pb.x} ${pb.y}`,
        fill: 'none',
      }, layer);
      // little arrowhead near pb
      const ang = Math.atan2(pb.y - cy, pb.x - cx);
      const hx = pb.x - Math.cos(ang) * 14, hy = pb.y - Math.sin(ang) * 14;
      el('path', {
        class: 'dl-arrow-head',
        d: `M ${hx + Math.cos(ang - 2.6) * 13} ${hy + Math.sin(ang - 2.6) * 13}
            L ${pb.x - Math.cos(ang) * 4} ${pb.y - Math.sin(ang) * 4}
            L ${hx + Math.cos(ang + 2.6) * 13} ${hy + Math.sin(ang + 2.6) * 13}`,
        fill: 'none',
      }, layer);
    }
  }
}

function stateColorVar(st) {
  return {
    [PSTATE.THINKING]: 'var(--c-think)',
    [PSTATE.HUNGRY]:   'var(--c-hungry)',
    [PSTATE.WAITING]:  'var(--c-wait)',
    [PSTATE.EATING]:   'var(--c-eat)',
  }[st] || 'var(--c-think)';
}

function faceFor(st, emoji, deadlock) {
  if (deadlock) return '😵';
  switch (st) {
    case PSTATE.EATING:   return '😋';
    case PSTATE.WAITING:  return '😬';
    case PSTATE.HUNGRY:   return '😮';
    default:              return emoji;
  }
}

function shortBubble(p, st, snap) {
  if (snap.deadlock && snap.deadlockCycle.includes(p.id)) return 'stuck! 😵';
  switch (st) {
    case PSTATE.EATING: return 'yum! 🍝';
    case PSTATE.HUNGRY: return 'hungry!';
    case PSTATE.WAITING:
      if (p.blockedOn?.kind === 'fork')   return `need 🍴${p.blockedOn.id}`;
      if (p.blockedOn?.kind === 'seat')   return 'need a seat';
      if (p.blockedOn?.kind === 'waiter') return 'waiting…';
      return 'got one 🍴';
    default: return '…';
  }
}
