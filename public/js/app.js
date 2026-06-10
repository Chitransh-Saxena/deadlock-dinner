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
// Manual mode is ON by default: philosophers only get hungry when you click
// them, so you can read the table and act deliberately.
const config = { n: 5, strategy: 'naive', thinkTime: 2, eatTime: 2, autoHunger: false };
const sim = new Simulation(config);

let playing = false;
let timer = null;
let speed = 2;             // 1..10 (lower = easier to follow along)
let deadlockCount = 0;
let sawDeadlock = false;
let jamSeq = 0;            // cancels the staged "jam it for me" animation if interrupted
let conditionsRevealed = false;   // the "four conditions" panel unlocks at the first jam

const scene = new Scene($('#stage-svg'), $('#stage-phils'), {
  onPhilClick: (id) => {
    const before = sim.deadlock;
    let status;
    if (sim.strategy === 'naive' && !sim.autoHunger) {
      // Robust hand-build: fill every LEFT fork first, and only once everyone
      // holds one do clicks reach RIGHT. No click order can make someone eat,
      // so causing a deadlock is now reliable instead of a hidden trap.
      status = sim.everyoneHoldsLeft() ? sim.nudge(id) : sim.grabLeft(id);
    } else {
      status = sim.nudge(id);              // safe rules & auto mode: normal grab
    }
    if (sim.deadlock && !before) { deadlockCount++; sawDeadlock = true; onDeadlock(); }
    render();                              // narrates the grab via the latest event
    if (status === 'busy') flashNarrator(`${sim.phils[id].name} is eating — let them finish. 🍝`, 'eat');
  },
});

// ---- game progress ---------------------------------------------------------
// Which safe rules the player has personally watched survive a full table.
const provenFixes = new Set();
let sawFullContention = false;   // every philosopher reaching for forks at once
const PROOF_WHY = {
  hierarchy: 'numbering the forks kills the circular wait.',
  waiter:    'grabbing both-or-none kills hold-and-wait.',
  semaphore: 'the empty chair leaves a gap in the circle.',
};

// ---- run loop --------------------------------------------------------------
// Deliberately gentle. Hyperbolic curve so the slow end is genuinely slow:
// speed 1 ≈ 2.4s per tick, default 2 ≈ 1.2s, max 10 ≈ 0.24s for the impatient.
function intervalMs() { return Math.round(2400 / speed); }

function play() {
  if (playing) return;
  jamSeq++;                 // any manual run cancels a pending jam animation
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
  renderObjective(snap);
  renderConditions(snap);
  renderLog();
  setStatus();
  // gentle "tap me" affordance, only at the very start (manual, nothing grabbed yet)
  const noneHeld = snap.forks.every(f => f.owner === null);
  $('#stage').classList.toggle('await-first', !sim.autoHunger && !snap.deadlock && snap.totalMeals === 0 && noneHeld);
  // narrator follows the latest meaningful event
  const ev = sim.events[sim.events.length - 1];
  if (ev && ev.id !== lastEventId) {
    lastEventId = ev.id;
    if (ev.kind !== 'system') flashNarrator(ev.text, ev.kind);
  }
  maybeProve(snap);   // last, so a "fix proven!" message wins the narrator
}

// ---- objective bar: states the goal for the current rule --------------------
function renderObjective(snap) {
  const obj = $('#objective');
  const badge = $('#objective-badge');
  const txt = $('#objective-text');
  const prog = $('#objective-progress');

  // NAÏVE = the "cause a deadlock" lesson, coached live, step by step.
  if (snap.strategy === 'naive') {
    badge.textContent = '① cause a deadlock';
    if (snap.deadlock) {
      obj.dataset.kind = 'jammed';
      prog.textContent = '';
      txt.innerHTML = `💥 <b>Deadlock!</b> Everyone holds one fork and waits for the next, in a circle — nobody can eat. See why 👇, then press <b>🩹 Break the jam</b>.`;
    } else if (sim.everyoneHoldsLeft()) {
      obj.dataset.kind = 'problem';
      prog.textContent = `${snap.n}/${snap.n} holding a fork`;
      txt.innerHTML = `✋ <b>Every fork is taken!</b> Now click each philosopher <b>again</b> to reach for their second fork — and the circle closes into a <b>deadlock</b>.`;
    } else {
      const held = snap.phils.filter(p => p.held.length > 0).length;
      obj.dataset.kind = 'problem';
      prog.textContent = `${held}/${snap.n} holding a fork`;
      txt.innerHTML = held === 0
        ? `🎯 <b>Goal: make a deadlock.</b> Click a philosopher to pick up a fork — a fork is a <b>lock</b> only they can hold.`
        : `🍴 That fork is now <b>locked</b> to them. Give <b>everyone</b> a fork — click the rest of the table.`;
    }
    return;
  }

  // SAFE RULES = the "prove a fix" levels.
  const s = STRATEGIES[snap.strategy];
  prog.textContent = `fixes proven · ${provenFixes.size}/3`;
  if (provenFixes.has(snap.strategy)) {
    obj.dataset.kind = 'proven';
    badge.textContent = '✓ fix proven';
    txt.innerHTML = `✅ <b>${s.name} holds</b> — ${PROOF_WHY[snap.strategy]} Try another fix, or go back to Naïve.`;
  } else {
    obj.dataset.kind = 'fix';
    badge.textContent = '② prove a fix';
    txt.innerHTML = `🛡️ <b>${s.name}.</b> Same hungry table, one new rule. Click everyone and try to jam it — you can’t.`;
  }
}

// ---- the four conditions: live "why it jams" panel -------------------------
const COND_ICON = { mutual: '🔒', holdwait: '✋', preempt: '⛔', circular: '🔄' };
const COND_STATE_LABEL = { inherent: 'always', armed: 'possible', active: 'happening', broken: 'blocked' };
function revealConditions() {
  if (conditionsRevealed) return;
  conditionsRevealed = true;
  const panel = $('#conditions');
  panel.classList.remove('reveal'); void panel.offsetWidth; panel.classList.add('reveal');
}
function renderConditions(snap) {
  const panel = $('#conditions');
  // Don't dump the four Coffman conditions on a newcomer up front — keep it a
  // teaser until they've actually caused a jam (or opened a fix), then reveal it.
  if (!conditionsRevealed) {
    panel.dataset.mode = 'teaser';
    $('#cond-verdict').textContent = 'Cause a deadlock and the four ingredients that make one will appear here.';
    $('#cond-list').innerHTML = '';
    return;
  }
  const conds = snap.conditions;
  $('#cond-list').innerHTML = conds.map(c => `
    <li class="cond cond--${c.state}" data-cond="${c.key}">
      <span class="cond__icon" aria-hidden="true">${COND_ICON[c.key]}</span>
      <span class="cond__body"><b class="cond__name">${c.label}</b><small class="cond__desc">${escapeHtml(c.desc)}</small></span>
      <span class="cond__state">${COND_STATE_LABEL[c.state]}</span>
    </li>`).join('');

  const verdict = $('#cond-verdict');
  const broken = conds.find(c => c.state === 'broken');
  if (broken) {
    panel.dataset.mode = 'safe';
    verdict.innerHTML = `<b>${broken.brokenBy}</b> removes <b>${broken.label.toLowerCase()}</b> → only 3 of 4 can hold, so this table <b>can’t</b> deadlock.`;
  } else if (snap.deadlock) {
    panel.dataset.mode = 'jammed';
    verdict.innerHTML = `<b>All four are true at once → DEADLOCK.</b> Break any single one and the table flows again.`;
  } else {
    panel.dataset.mode = 'threat';
    verdict.innerHTML = `All four can happen here, so this table <b>can</b> deadlock. Try to make it.`;
  }
}

// ---- proof: the player watched a safe rule survive a full, contended table --
function maybeProve(snap) {
  if (snap.phils.every(p => p.display !== PSTATE.THINKING)) sawFullContention = true;
  const s = STRATEGIES[snap.strategy];
  if (!s.safe || provenFixes.has(snap.strategy)) return;
  // Proven once you've reproduced the naive failure setup — everyone reaching at
  // once — and yet the table kept flowing (someone ate, nobody deadlocked).
  if (sawFullContention && !snap.deadlock && snap.totalMeals > 0) {
    provenFixes.add(snap.strategy);
    $(`.strat-card[data-strat="${snap.strategy}"]`)?.classList.add('is-proven');
    $('#proven-count').textContent = `${provenFixes.size}/3`;
    renderObjective(snap);
    flashNarrator(`✅ Proven: ${s.name} can’t deadlock — ${PROOF_WHY[snap.strategy]}`, 'eat');
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
  revealConditions();          // the "why" panel unlocks the first time you jam
  const banner = $('#deadlock-banner');
  banner.hidden = false;
  banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
  document.body.classList.add('is-deadlock');
}

// Break the jam, then run a few steps so the recovery is VISIBLE — the freed
// neighbour can now eat, release, and the table flows again. Teaches that one
// release breaks the whole circle (instead of leaving a confusing half-stuck table).
function breakJam() {
  if (!sim.deadlock) { flashNarrator('No deadlock right now — nothing to break.', 'info'); return; }
  const my = ++jamSeq;
  sim.resolveDeadlock();       // one philosopher sets a fork down
  clearDeadlockUI();
  render();
  flashNarrator('One philosopher set a fork down — that single release breaks the circle. Watch it flow again…', 'resolve');
  pause();
  let steps = 7;
  const tick = () => {
    if (my !== jamSeq) return;                       // cancelled by reset / play / re-jam
    if (steps-- <= 0 || sim.deadlock) {
      pause(); render();
      flashNarrator('✅ Cleared! That’s a deadlock — you caused it and escaped it. Now beat it for good: pick a Fix → and try to jam the table again.', 'eat');
      return;
    }
    sim.step(); render();
    timer = setTimeout(tick, 540);
  };
  timer = setTimeout(tick, 480);
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
  jamSeq++;                    // cancel any in-flight jam animation
  Object.assign(config, extra);
  sim.reset(config);
  lastEventId = 0;
  sawFullContention = false;   // proof must be re-earned on a fresh table
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
      flashNarrator(`The “${STRATEGIES[sim.strategy].name}” rule can’t deadlock — that’s the point! Switch to Naïve to cause one.`, 'warn');
      return;
    }
    pause();
    const my = ++jamSeq;
    // Beat 1 — everyone grabs their LEFT fork at the same instant (no jam yet).
    sim.triggerClassicDeadlock();
    render();
    flashNarrator('Watch: every philosopher grabs their LEFT fork at the same instant…', 'grab');
    // Beat 2 — a breath later, each turns to the RIGHT fork… the neighbour has it.
    setTimeout(() => {
      if (my !== jamSeq) return;
      flashNarrator('…now each needs the fork on their RIGHT — but the neighbour won’t let go.', 'warn');
      // Beat 3 — the circle closes. Deadlock; the table stays visible so you see it.
      setTimeout(() => { if (my === jamSeq) stepOnce(); }, 1150);
    }, 1550);
  });

  $$('.js-resolve').forEach(b => b.addEventListener('click', breakJam));

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
    // keep config in sync so the setting survives resets / strategy changes
    config.autoHunger = !manualEl.checked;
    sim.autoHunger = config.autoHunger;
    document.body.classList.toggle('manual-mode', manualEl.checked);
    flashNarrator(manualEl.checked
      ? 'Manual mode: click philosophers to pick up forks, one at a time.'
      : 'Auto mode: philosophers get hungry and grab forks on their own. Press ▶ Play.', 'info');
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
  if (key !== 'naive') revealConditions();   // a fix is meaningless without the conditions it breaks
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
  // No auto-tour: the objective bar now coaches the lesson live, step by step.
  // The control tour is still available on demand via the “?” help button.
}

// ============================================================================
//  Guided tour (coachmarks)
// ============================================================================
const TOUR_STEPS = [
  { sel: '#objective',     title: 'Your mission',         body: "This bar always tells you the goal. Right now: cause a deadlock on the Naïve rule." },
  { sel: '#stage',         title: 'Click to grab a fork', body: "Tap a philosopher to pick up ONE fork. Give everyone their first fork, then reach for the second — and the table jams. You just built a deadlock!" },
  { sel: '#card-strategy', title: 'Cause it, then fix it', body: "① Jam the table on Naïve. ② Then switch to a fix and try the same thing — it won’t jam, and the game shows you why." },
  { sel: '#card-controls', title: 'Play, step, or skip',  body: "Play and Step run the table on their own. In a hurry? ‘⚡ Jam it for me’ builds the whole jam at once; ‘🩹 Break the jam’ frees a stuck table. Switch Manual mode off to let them eat on their own." },
  { sel: '#adv',           title: 'Tinker & details',     body: "Open this for speed, table size, think/eat times, and the live event log." },
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
  document.body.classList.toggle('manual-mode', !config.autoHunger);
  selectStrategy('naive');
  scene.rebuildLayout(sim.n);
  render();
  reflectCodeBtns();
  setStatus();
  // gentle intro — lead with the goal; the objective bar coaches the rest live
  flashNarrator('Goal: make a deadlock. Click a philosopher to pick up a fork — give everyone one, then click again to reach for the second. 🍝', 'info');
}

document.addEventListener('DOMContentLoaded', boot);
