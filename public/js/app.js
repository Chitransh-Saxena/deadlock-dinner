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
let speed = 7;             // 1..10
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
function intervalMs() { return Math.round(900 - speed * 78); } // speed 1→822ms, 10→120ms

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
  if (name === 'code') renderCode();
}

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
