// ============================================================================
//  app.js — wires the engine + renderer to the controls, tabs, narrator, log,
//  stats and the Java/Go code viewer.
// ============================================================================

import { Simulation, STRATEGIES, PSTATE } from './sim.js';
import { Scene } from './render.js';
import { CODE } from './code-samples.js';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- state -----------------------------------------------------------------
const config = { n: 5, strategy: 'naive', thinkTime: 2, eatTime: 2, autoHunger: true };
const sim = new Simulation(config);

let playing = false;
let timer = null;
let speed = 3;             // 1..10 (lower = easier to follow along)
let deadlockCount = 0;
let sawDeadlock = false;

const scene = new Scene($('#stage-svg'), $('#stage-phils'), {
  onPhilClick: (id) => {
    sim.makeHungry(id);
    flashNarrator(`You nudged ${sim.phils[id].name} — they’re reaching for forks!`, 'hungry');
    render();
  },
});

// ---- run loop --------------------------------------------------------------
// Deliberately gentle by default so a human can read each move. speed 1 ≈ 1s
// per tick, default 3 ≈ 0.8s, max 10 ≈ 0.15s for the impatient.
function intervalMs() { return Math.round(1100 - speed * 95); }

function play() {
  if (playing) return;
  playing = true;
  $('#btn-play').classList.add('is-playing');
  $('#btn-play .btn__label').textContent = 'Pause';
  $('#btn-play .btn__icon').textContent = '⏸';
  loop();
  setStatus();
}
function pause() {
  playing = false;
  clearTimeout(timer);
  $('#btn-play').classList.remove('is-playing');
  $('#btn-play .btn__label').textContent = 'Play';
  $('#btn-play .btn__icon').textContent = '▶';
  setStatus();
}
function togglePlay() { playing ? pause() : play(); }

function loop() {
  if (!playing) return;
  stepOnce();
  if (sim.deadlock) { pause(); return; }   // freeze on deadlock so it's readable
  timer = setTimeout(loop, intervalMs());
}

function stepOnce() {
  const before = sim.deadlock;
  sim.step();
  if (sim.deadlock && !before) {
    deadlockCount++;
    sawDeadlock = true;
    onDeadlock();
  }
  render();
}

// ---- render orchestration --------------------------------------------------
let lastEventId = 0;
function render() {
  const snap = sim.snapshot();
  scene.update(snap);
  renderStats(snap);
  renderLog();
  setStatus();
  // narrator follows the latest meaningful event
  const ev = sim.events[sim.events.length - 1];
  if (ev && ev.id !== lastEventId) {
    lastEventId = ev.id;
    if (ev.kind !== 'system') flashNarrator(ev.text, ev.kind);
  }
}

// ---- narrator + log --------------------------------------------------------
function flashNarrator(text, kind = 'info') {
  const n = $('#narrator');
  n.className = `narrator narrator--${kind}`;
  $('#narrator-text').textContent = text;
  n.classList.remove('narrator--pulse');
  void n.offsetWidth;            // restart animation
  n.classList.add('narrator--pulse');
}

function renderLog() {
  const log = $('#log');
  // render only the tail, newest first
  const items = sim.events.slice(-40).reverse();
  log.innerHTML = items.map(e =>
    `<li class="log__item log__item--${e.kind}">
       <span class="log__tick">t${e.tick}</span>
       <span class="log__text">${escapeHtml(e.text)}</span>
     </li>`).join('');
}

// ---- stats -----------------------------------------------------------------
function renderStats(snap) {
  $('#stat-tick').textContent = snap.tick;
  $('#stat-meals').textContent = snap.totalMeals;
  $('#stat-deadlocks').textContent = deadlockCount;

  // per-philosopher meal bars
  const wrap = $('#meal-bars');
  const max = Math.max(1, ...snap.phils.map(p => p.meals));
  wrap.innerHTML = snap.phils.map(p => `
    <div class="mealbar">
      <span class="mealbar__name">${escapeHtml(p.name)}</span>
      <span class="mealbar__track"><span class="mealbar__fill mealbar__fill--${p.display}" style="width:${(p.meals / max) * 100}%"></span></span>
      <span class="mealbar__num">${p.meals}</span>
    </div>`).join('');

  // strategy-specific readout
  const rd = $('#strategy-readout');
  if (snap.strategy === 'semaphore') {
    rd.hidden = false;
    rd.innerHTML = `🪑 <strong>${snap.seatsFree}</strong> of ${Math.max(1, snap.n - 1)} seats free`;
  } else if (snap.strategy === 'waiter') {
    rd.hidden = false;
    const queued = snap.phils.filter(p => p.blockedOn?.kind === 'waiter').length;
    const eating = snap.phils.filter(p => p.display === PSTATE.EATING).length;
    rd.innerHTML = `🤵 Waiter on duty · <strong>${eating}</strong> eating · <strong>${queued}</strong> waiting for the OK`;
  } else {
    rd.hidden = true;
  }
}

// ---- deadlock UI -----------------------------------------------------------
function onDeadlock() {
  const banner = $('#deadlock-banner');
  banner.hidden = false;
  banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
  document.body.classList.add('is-deadlock');
}
function clearDeadlockUI() {
  $('#deadlock-banner').hidden = true;
  document.body.classList.remove('is-deadlock');
}

// ---- status pill -----------------------------------------------------------
function setStatus() {
  const pill = $('#status-pill');
  if (sim.deadlock)      { pill.dataset.state = 'deadlock'; pill.textContent = '● DEADLOCK'; }
  else if (playing)      { pill.dataset.state = 'running';  pill.textContent = '● running'; }
  else                   { pill.dataset.state = 'paused';   pill.textContent = '❚❚ paused'; }
}

// ---- reset / config --------------------------------------------------------
function resetSim(extra = {}) {
  pause();
  Object.assign(config, extra);
  sim.reset(config);
  lastEventId = 0;
  clearDeadlockUI();
  scene.rebuildLayout(sim.n);
  render();
  flashNarrator(`Fresh table: ${sim.n} philosophers, “${STRATEGIES[sim.strategy].name}” rule.`, 'info');
  syncStrategyCopy();
}

// ============================================================================
//  Controls wiring
// ============================================================================
function paintRange(el) {
  const min = +el.min || 0, max = +el.max || 100;
  const pct = ((+el.value - min) / (max - min)) * 100;
  el.style.setProperty('--p', `${pct}%`);
}

function wireControls() {
  $('#btn-play').addEventListener('click', togglePlay);
  $('#btn-step').addEventListener('click', () => { pause(); stepOnce(); });
  $('#btn-reset').addEventListener('click', () => resetSim());

  $('#btn-deadlock').addEventListener('click', () => {
    if (sim.strategy !== 'naive') {
      flashNarrator(`The “${STRATEGIES[sim.strategy].name}” rule prevents deadlock — switch to Naïve to see one!`, 'warn');
      return;
    }
    pause();
    sim.triggerClassicDeadlock();
    render();                 // shows everyone holding their left fork
    flashNarrator('Everyone grabbed their LEFT fork at once. Press Step or Play…', 'warn');
  });

  $$('.js-resolve').forEach(b => b.addEventListener('click', () => {
    if (!sim.deadlock) { flashNarrator('No deadlock right now — nothing to resolve.', 'info'); return; }
    sim.resolveDeadlock();
    clearDeadlockUI();
    render();
  }));

  // speed
  const speedEl = $('#ctl-speed');
  speedEl.addEventListener('input', () => {
    speed = +speedEl.value;
    $('#ctl-speed-val').textContent = `${speed}`;
    paintRange(speedEl);
  });

  // philosopher count
  const nEl = $('#ctl-n');
  nEl.addEventListener('input', () => {
    $('#ctl-n-val').textContent = nEl.value;
    paintRange(nEl);
  });
  nEl.addEventListener('change', () => resetSim({ n: +nEl.value }));

  // think / eat times
  const thinkEl = $('#ctl-think');
  thinkEl.addEventListener('input', () => { $('#ctl-think-val').textContent = thinkEl.value; paintRange(thinkEl); });
  thinkEl.addEventListener('change', () => resetSim({ thinkTime: +thinkEl.value }));

  const eatEl = $('#ctl-eat');
  eatEl.addEventListener('input', () => { $('#ctl-eat-val').textContent = eatEl.value; paintRange(eatEl); });
  eatEl.addEventListener('change', () => resetSim({ eatTime: +eatEl.value }));

  // initial fill paint
  [speedEl, nEl, thinkEl, eatEl].forEach(paintRange);

  // manual mode
  const manualEl = $('#ctl-manual');
  manualEl.addEventListener('change', () => {
    sim.autoHunger = !manualEl.checked;
    flashNarrator(manualEl.checked
      ? 'Manual mode: click a philosopher to make them hungry.'
      : 'Auto mode: philosophers get hungry on their own.', 'info');
    render();
  });

  // strategy cards
  $$('.strat-card').forEach(card => {
    card.addEventListener('click', () => selectStrategy(card.dataset.strat));
  });

  // tabs
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // home <-> sim navigation
  const goHome = () => switchTab('home');
  const goSim  = () => switchTab('sim');
  $('#brand').addEventListener('click', goHome);
  $('#brand').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } });
  $('#back-home').addEventListener('click', goHome);
  $('#cta-start').addEventListener('click', goSim);
  $('#cta-start-2').addEventListener('click', goSim);
  $('#btn-help').addEventListener('click', startTour);

  // code viewer
  $$('.lang-btn').forEach(b => b.addEventListener('click', () => setCodeLang(b.dataset.lang)));
  $$('.codestrat-btn').forEach(b => b.addEventListener('click', () => setCodeStrat(b.dataset.strat)));
  $('#btn-copy').addEventListener('click', copyCode);

  // keyboard niceties
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 's') { pause(); stepOnce(); }
    else if (e.key === 'r') { resetSim(); }
  });
}

function selectStrategy(key) {
  $$('.strat-card').forEach(c => c.classList.toggle('is-active', c.dataset.strat === key));
  $('#btn-deadlock').disabled = key !== 'naive';
  resetSim({ strategy: key });
  // update the "how it works" explainer
  const s = STRATEGIES[key];
  $('#strat-explain-title').textContent = `${s.name} — ${s.tagline}`;
  $('#strat-explain-kid').textContent = s.kid;
  $('#strat-explain-tech').textContent = s.tech;
  $('#strat-explain-badge').textContent = s.safe ? 'deadlock-free' : 'can deadlock';
  $('#strat-explain-badge').dataset.safe = String(s.safe);
}

// ============================================================================
//  Tabs
// ============================================================================
function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'code') renderCode();
  // First time a visitor reaches the table, offer the guided tour.
  if (name === 'sim' && !localStorage.getItem('dd_tour_seen')) {
    setTimeout(startTour, 450);
  }
}

// ============================================================================
//  Guided tour (coachmarks)
// ============================================================================
const TOUR_STEPS = [
  { sel: '#card-strategy', title: 'Pick a rule',        body: "Choose how the philosophers grab forks. ‘Naïve’ can get stuck — the other three are deadlock-free." },
  { sel: '#card-controls', title: 'Play, or step',      body: "Press Play to run it slowly, or Step to move one tick at a time so you can read every move." },
  { sel: '#btn-deadlock',  title: 'Make a deadlock',    body: "On the Naïve rule, this makes everyone grab a fork at once — and the whole table freezes. ‘Break the jam’ frees it." },
  { sel: '#stage',         title: 'Click a philosopher', body: "Tap anyone at the table to make them hungry and reach for forks. Try it!" },
  { sel: '#card-sliders',  title: 'Turn the dials',     body: "Slow things down, add or remove philosophers, and change how long they think and eat." },
];
let tourIdx = 0;
let tourEls = null;

function buildTourDom() {
  const wrap = document.createElement('div');
  wrap.className = 'tour'; wrap.hidden = true;
  wrap.innerHTML = `
    <div class="tour__spot"></div>
    <div class="tour__pop">
      <div class="tour__step"></div>
      <div class="tour__title"></div>
      <p class="tour__body"></p>
      <div class="tour__btns">
        <button class="tour__skip">Skip</button>
        <button class="btn btn--small" data-tour="back">Back</button>
        <button class="btn btn--small btn--primary" data-tour="next">Next</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  tourEls = {
    wrap, spot: $('.tour__spot', wrap), pop: $('.tour__pop', wrap),
    step: $('.tour__step', wrap), title: $('.tour__title', wrap), body: $('.tour__body', wrap),
    back: $('[data-tour="back"]', wrap), next: $('[data-tour="next"]', wrap), skip: $('.tour__skip', wrap),
  };
  tourEls.skip.addEventListener('click', endTour);
  tourEls.back.addEventListener('click', () => gotoTourStep(tourIdx - 1));
  tourEls.next.addEventListener('click', () => {
    if (tourIdx >= TOUR_STEPS.length - 1) endTour();
    else gotoTourStep(tourIdx + 1);
  });
  window.addEventListener('resize', () => { if (!tourEls.wrap.hidden) positionTour(); });
}

function startTour() {
  if (!tourEls) buildTourDom();
  localStorage.setItem('dd_tour_seen', '1');
  // make sure we're on the simulation so targets exist & are visible
  $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === 'sim'));
  $$('.panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === 'sim'));
  tourEls.wrap.hidden = false;
  gotoTourStep(0);
}
function gotoTourStep(i) {
  tourIdx = Math.max(0, Math.min(TOUR_STEPS.length - 1, i));
  const s = TOUR_STEPS[tourIdx];
  tourEls.step.textContent = `Step ${tourIdx + 1} of ${TOUR_STEPS.length}`;
  tourEls.title.textContent = s.title;
  tourEls.body.textContent = s.body;
  tourEls.back.style.visibility = tourIdx === 0 ? 'hidden' : 'visible';
  tourEls.next.textContent = tourIdx === TOUR_STEPS.length - 1 ? 'Got it! 🎉' : 'Next →';
  const target = $(s.sel);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(positionTour, 340);
}
function positionTour() {
  const s = TOUR_STEPS[tourIdx];
  const target = $(s.sel);
  if (!target) return;
  const r = target.getBoundingClientRect();
  const pad = 8;
  Object.assign(tourEls.spot.style, {
    top: `${r.top - pad}px`, left: `${r.left - pad}px`,
    width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
  });
  const pop = tourEls.pop;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let top = r.bottom + pad + 12;
  if (top + ph > vh - 12) top = Math.max(12, r.top - ph - pad - 12);
  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(12, Math.min(left, vw - pw - 12));
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}
function endTour() { if (tourEls) tourEls.wrap.hidden = true; }

// ============================================================================
//  Code viewer
// ============================================================================
let codeLang = 'java';
let codeStrat = 'naive';

function syncStrategyCopy() {
  // keep the code tab in step with the chosen simulation strategy
  setCodeStrat(sim.strategy, false);
}
function setCodeLang(lang)  { codeLang = lang; renderCode(); reflectCodeBtns(); }
function setCodeStrat(strat, rerender = true) {
  codeStrat = strat;
  reflectCodeBtns();
  if (rerender) renderCode();
}
function reflectCodeBtns() {
  $$('.lang-btn').forEach(b => b.classList.toggle('is-active', b.dataset.lang === codeLang));
  $$('.codestrat-btn').forEach(b => b.classList.toggle('is-active', b.dataset.strat === codeStrat));
}
function renderCode() {
  const code = CODE[codeLang]?.[codeStrat] || '// not found';
  const elc = $('#code-block');
  elc.className = `language-${codeLang === 'go' ? 'go' : 'java'}`;
  elc.textContent = code;
  if (window.hljs) { delete elc.dataset.highlighted; window.hljs.highlightElement(elc); }
  $('#code-caption').textContent = `${codeLang === 'go' ? 'Go' : 'Java'} · ${STRATEGIES[codeStrat].name} — ${STRATEGIES[codeStrat].tagline}`;
}
async function copyCode() {
  try {
    await navigator.clipboard.writeText(CODE[codeLang][codeStrat]);
    const b = $('#btn-copy');
    const old = b.textContent; b.textContent = '✓ copied'; b.classList.add('is-ok');
    setTimeout(() => { b.textContent = old; b.classList.remove('is-ok'); }, 1400);
  } catch { flashNarrator('Copy failed — select the code manually.', 'warn'); }
}

// ---- utils -----------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---- boot ------------------------------------------------------------------
function boot() {
  wireControls();
  selectStrategy('naive');
  scene.rebuildLayout(sim.n);
  render();
  reflectCodeBtns();
  setStatus();
  // gentle intro
  flashNarrator('Welcome! 5 philosophers, 5 forks. Each needs TWO forks to eat. Press Play ▶', 'info');
}

document.addEventListener('DOMContentLoaded', boot);
