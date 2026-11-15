import { World } from './world.js';
import { PROMPTS } from '../lib/prompts.js';
import { TIERS, M_PER_PT, BEARING, bearingFor, TIER_LINES } from '../lib/scoring.js';
import { tierIconURL } from './sprites.js';
import { sfx } from './audio.js';
import { submitAnswer, submitScore, suggestPrompt, isOffline } from './api.js';
import { distributionSVG, diveLogSVG, percentile } from './charts.js';
import { CONFIG } from './config.js';

const $ = (s) => document.querySelector(s);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');
const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtM = (m) => `${Math.round(m).toLocaleString('en-US')}m`;

const world = new World($('#world'));
window.__world = world; // handy for debugging

// ---------------------------------------------------------------- stats
const STATS_KEY = 'ku_stats_v1';
function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
    if (s && typeof s === 'object') return { played: 0, total: 0, best: 0, history: [], seen: [], diveNo: 0, today: { d: '', n: 0 }, ...s };
  } catch { /* ignore */ }
  return { played: 0, total: 0, best: 0, history: [], seen: [], diveNo: 0, today: { d: '', n: 0 } };
}
const stats = loadStats();
const saveStats = () => { try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* ignore */ } };
const todayStr = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- state
const S = {
  phase: 'title', // title | countdown | answering | sinking | reveal | results
  prompts: [],
  round: 0,
  score: 0,
  shownScore: 0,
  results: [],
  sink: null,
  timerId: null,
  deadline: 0,
  lastTick: 0,
  token: 0, // invalidates async work when a dive is quit
};

// ---------------------------------------------------------------- setup text
document.title = `${CONFIG.fullName} · dive as much as you like`;
$('.logo').dataset.text = CONFIG.name;
$('.logo span').textContent = CONFIG.name;
$('#subTitle').textContent = CONFIG.subtitle;
$('.tagline').textContent = `${CONFIG.rounds} prompts · ${CONFIG.seconds} seconds each · rarer answers sink deeper`;

function refreshTitleMeta() {
  const parts = [`DIVE #${stats.diveNo + 1}`];
  if (stats.played) parts.push(`BEST ${stats.best}`);
  $('#titleMeta').textContent = parts.join(' · ');
}
refreshTitleMeta();

$('#tierList').innerHTML = ['plankton', 'clever', 'schooler', 'rare', 'deepcut', 'krillion']
  .map((id) => `<li><img src="${tierIconURL(id, 3)}" alt=""><span style="color:${TIERS[id].color}">${TIERS[id].name}</span><b>${TIERS[id].pts}</b></li>`)
  .join('');

function updateMuteUI() {
  $('#muteBtn').classList.toggle('muted', sfx.isMuted());
  $('#menuSound').textContent = `SOUND: ${sfx.isMuted() ? 'OFF' : 'ON'}`;
}
updateMuteUI();

// ---------------------------------------------------------------- prompts
function pickPrompts() {
  const seen = new Set(stats.seen);
  let pool = PROMPTS.filter((p) => !seen.has(p.id));
  if (pool.length < CONFIG.rounds) {
    stats.seen = [];
    pool = [...PROMPTS];
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = pool.slice(0, CONFIG.rounds);
  stats.seen.push(...chosen.map((p) => p.id));
  stats.seen = stats.seen.slice(-Math.max(0, PROMPTS.length - CONFIG.rounds * 2));
  saveStats();
  return chosen;
}

// ---------------------------------------------------------------- HUD
function buildPips() {
  $('#pips').innerHTML = Array.from({ length: CONFIG.rounds }, () => '<i></i>').join('');
}
function updatePips() {
  [...$('#pips').children].forEach((el, i) => {
    el.className = '';
    el.style.background = '';
    el.style.borderColor = '';
    if (i < S.results.length) {
      const c = TIERS[S.results[i].tier].color;
      el.style.background = c;
      el.style.borderColor = c;
    } else if (i === S.round && S.phase !== 'results') el.className = 'cur';
  });
  $('#progText').textContent = S.round >= CONFIG.rounds ? 'DIVE COMPLETE' : `PROMPT ${S.round + 1} OF ${CONFIG.rounds}`;
}

// ---------------------------------------------------------------- flow
async function startDive() {
  sfx.unlock();
  sfx.click();
  S.token++;
  hide($('#title'));
  hide($('#results'));
  hide($('#reveal'));
  hide($('#nextBtn'));
  show($('#hud'));
  S.prompts = pickPrompts();
  S.round = 0;
  S.score = 0;
  S.shownScore = 0;
  S.results = [];
  S.sink = null;
  stats.diveNo += 1;
  saveStats();
  world.mode = 'game';
  world.player = 0;
  world.follow = false;
  world.clearTierLines();
  world.krill.attach = null;
  buildPips();
  $('#scoreVal').textContent = '0';
  await sleep(700);
  beginRound();
}

async function beginRound() {
  const token = S.token;
  S.phase = 'countdown';
  const p = S.prompts[S.round];
  updatePips();
  $('#promptKicker').textContent = `PROMPT ${S.round + 1} OF ${CONFIG.rounds}`;
  $('#promptQ').textContent = p.q;
  const card = $('#promptCard');
  card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
  show(card);
  const bar = $('#inputBar');
  bar.classList.remove('enter'); void bar.offsetWidth; bar.classList.add('enter');
  show(bar);
  const input = $('#answer');
  input.value = '';
  input.disabled = true;
  $('#diveBtn').disabled = true;
  setTimerUI(CONFIG.seconds, 1);
  show($('#countdown'));
  for (let n = CONFIG.countdown; n > 0; n--) {
    $('#cdNum').textContent = n;
    sfx.countdown(n);
    await sleep(800);
    if (token !== S.token) return;
  }
  hide($('#countdown'));
  startTimer();
}

function setTimerUI(secs, frac) {
  $('#timerNum').textContent = Math.ceil(secs);
  $('#timerArc').style.strokeDashoffset = String(163.4 * (1 - frac));
  $('#timeFill').style.transform = `scaleX(${frac})`;
  $('.timer').classList.toggle('low', secs <= 5 && secs > 0);
}

function startTimer() {
  S.phase = 'answering';
  const input = $('#answer');
  input.disabled = false;
  $('#diveBtn').disabled = false;
  input.focus({ preventScroll: true });
  S.deadline = performance.now() + CONFIG.seconds * 1000;
  S.lastTick = CONFIG.seconds;
  clearInterval(S.timerId);
  S.timerId = setInterval(() => {
    const left = Math.max(0, (S.deadline - performance.now()) / 1000);
    setTimerUI(left, left / CONFIG.seconds);
    const whole = Math.ceil(left);
    if (whole !== S.lastTick) {
      S.lastTick = whole;
      if (whole <= 5 && whole > 0) sfx.tick();
    }
    if (left <= 0) submit(true);
  }, 100);
}

async function submit(fromTimeout = false) {
  if (S.phase !== 'answering') return;
  const input = $('#answer');
  const text = input.value.trim();
  if (!text && !fromTimeout) {
    input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
    return;
  }
  const token = S.token;
  S.phase = 'sinking';
  clearInterval(S.timerId);
  input.disabled = true;
  input.blur();
  hide($('#promptCard'));
  hide($('#inputBar'));
  hide($('#countdown'));
  const p = S.prompts[S.round];
  const start = world.player;

  const label = $('#sinkLabel');
  label.style.color = '';
  $('#sinkText').textContent = text ? `“${text}”` : '…out of air…';
  show(label);
  positionLabel();
  sfx.bubbles();
  world.burst(world.W / 2, labelY(), 26, 120);
  world.krill.attach = () => ({ x: world.W / 2 + Math.min(label.offsetWidth / 2 + 34, world.W * 0.45), y: labelY() - 6 });

  const [res] = await Promise.all([
    text ? submitAnswer(p.id, text) : Promise.resolve({ tier: 'outofair', name: TIERS.outofair.name, pts: 0, display: '', crowd: '' }),
    sleep(text ? 750 : 400),
  ]);
  if (token !== S.token) return;

  const tier = TIERS[res.tier] ? res.tier : 'plankton';
  const pts = TIERS[tier].pts;
  const target = start + pts * M_PER_PT;
  if (res.display) $('#sinkText').textContent = `“${res.display}”`;

  const finishLanding = async () => {
    world.landTier(tier);
    label.style.color = TIERS[tier].color;
    sfx.land(tier);
    world.burst(world.W / 2, labelY(), tier === 'krillion' ? 50 : 22, 160);
    S.score += pts;
    S.results.push({ promptId: p.id, q: p.q, answer: text, display: res.display || text, tier, pts, crowd: res.crowd || '', offline: !!res.offline });
    updatePips();
    await sleep(700);
    if (token !== S.token) return;
    showReveal(tier, res, pts);
  };

  if (pts === 0) {
    finishLanding();
    return;
  }
  world.startTierLines(start);
  world.follow = true;
  const dur = 1000 + Math.sqrt(pts * M_PER_PT) * 75;
  S.sink = { from: start, to: target, t0: performance.now(), dur, passed: new Set(), done: finishLanding };
  sfx.sink(dur / 1000);
}

function labelY() {
  return world.y(world.player) + 16;
}
function positionLabel() {
  const label = $('#sinkLabel');
  label.style.top = `${Math.round(labelY())}px`;
}

function showReveal(tier, res, pts) {
  S.phase = 'reveal';
  const t = TIERS[tier];
  $('#rvIcon').src = tierIconURL(tier, 5);
  $('#rvIcon').style.filter = `drop-shadow(0 0 12px ${t.color})`;
  $('#rvName').textContent = t.name;
  $('#rvName').style.color = t.color;
  $('#rvName').style.textShadow = `0 0 18px ${t.color}66`;
  $('#rvAns').textContent = res.display ? `“${res.display}”` : 'no answer';
  $('#rvPts').innerHTML = `<span style="color:${t.color}">+${pts} PTS</span> · sink ${fmtM(pts * M_PER_PT)}`;
  $('#rvFlavor').textContent = t.flavor;
  $('#rvCrowd').textContent = res.crowd || '';
  const rv = $('#reveal');
  rv.style.animation = 'none'; void rv.offsetWidth; rv.style.animation = '';
  show(rv);
  hide($('#sinkLabel'));
  world.clearTierLines();
  world.krill.attach = null;
  world.krill.retarget = 0;
  const last = S.round >= CONFIG.rounds - 1;
  const btn = $('#nextBtn');
  btn.textContent = last ? 'SURFACE ▲' : 'DESCEND ▼';
  show(btn);
  btn.focus({ preventScroll: true });
}

function next() {
  if (S.phase !== 'reveal') return;
  sfx.click();
  hide($('#reveal'));
  hide($('#nextBtn'));
  hide($('#sinkLabel'));
  world.clearTierLines();
  world.follow = false;
  world.krill.attach = null;
  S.round += 1;
  if (S.round < CONFIG.rounds) beginRound();
  else finishDive();
}

async function finishDive() {
  const token = S.token;
  S.phase = 'results';
  updatePips();
  hide($('#hud'));
  sfx.finish();
  // stats
  stats.played += 1;
  stats.total += S.score;
  stats.best = Math.max(stats.best, S.score);
  stats.history = [...stats.history, S.score].slice(-100);
  if (stats.today.d !== todayStr()) stats.today = { d: todayStr(), n: 0 };
  stats.today.n += 1;
  saveStats();
  const finalDepth = world.player;
  world.mode = 'results';
  const hist = await submitScore(S.score);
  if (token !== S.token) return;
  renderResults(hist.buckets || {}, finalDepth);
}

function shareText(pct) {
  const emojis = S.results.map((r) => TIERS[r.tier].emoji).join('');
  return `🦐 ${CONFIG.fullName.toUpperCase()} · DIVE #${stats.diveNo}\n${S.score} pts · -${fmtM(S.score * M_PER_PT)} · better than ${pct}% of divers\n${emojis}\n${location.origin}`;
}

function renderResults(buckets, finalDepth) {
  const pct = percentile(buckets, S.score);
  const band = bearingFor(S.score);
  const avg = stats.played ? Math.round(stats.total / stats.played) : 0;
  const offline = isOffline() || S.results.some((r) => r.offline);
  const html = `
    <div class="res-head">
      <div class="logo-sm" data-text="${esc(CONFIG.name)}"><span>${esc(CONFIG.name)}</span></div>
      <div class="res-dive">DIVE #${stats.diveNo} COMPLETE</div>
    </div>
    <div class="res-score"><b id="bigScore">0</b><span>-${fmtM(finalDepth)}</span></div>
    ${distributionSVG(buckets, S.score)}
    <div class="better">BETTER THAN ${pct}% OF DIVERS</div>
    ${offline ? '<div class="offline-note">Offline mode: rarity is estimated from built-in data.</div>' : ''}

    <h3 class="sec">DIVE LOG <small>DEEPER = RARER</small></h3>
    ${diveLogSVG(S.results)}

    <h3 class="sec">THE BEARING</h3>
    <ul class="bearing">
      ${BEARING.map((b) => `<li class="${b === band ? 'me' : ''}"><img src="${tierIconURL(b.tier, 2)}" alt=""><span class="rng" style="color:${TIERS[b.tier].color}">${b.label}</span><span>${b.text}</span></li>`).join('')}
    </ul>

    <div class="btn-row">
      <button id="copyBtn" class="pink-btn">COPY RESULT</button>
      <button id="shareBtn" class="ghost-btn">SHARE_</button>
    </div>
    <button id="againBtn" class="cyan-btn">KEEP DIVING ∞</button>

    <h3 class="sec">THE CATCH <small>EVERY ANSWER</small></h3>
    <ol class="catch">
      ${S.results.map((r, i) => `
        <li>
          <span class="n">${i + 1}</span>
          <img src="${tierIconURL(r.tier, 3)}" alt="">
          <div><div class="pq">${esc(r.q)}</div><div class="pa">${esc(r.display || '—')}</div><div class="pc">${esc(r.crowd)}</div></div>
          <span class="pp" style="color:${TIERS[r.tier].color}">${r.pts}</span>
        </li>`).join('')}
    </ol>

    <h3 class="sec">LOGBOOK</h3>
    <div class="logbook">PLAYED <b>${stats.played}</b> · AVG <b>${avg}</b> · BEST <b>${stats.best}</b> · TODAY <b>${stats.today.n}</b></div>
    <div class="nextdive">NEXT DIVE IN <b>00:00:00 · RIGHT NOW</b></div>

    <form class="suggest" id="suggestForm">
      <label>GOT AN IDEA FOR A PROMPT? TELL US WHAT TO ASK</label>
      <div class="row"><input id="suggestInput" maxlength="140" placeholder="name a type of cloud…"><button type="submit">SUBMIT</button></div>
    </form>
    <div class="res-foot">${esc(CONFIG.fullName.toUpperCase())} · NO DAILY LIMIT</div>
  `;
  $('#resInner').innerHTML = html;
  const res = $('#results');
  res.scrollTop = 0;
  show(res);

  // count-up
  const big = $('#bigScore');
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / 1100);
    big.textContent = Math.round(S.score * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);

  $('#copyBtn').onclick = async () => {
    const ok = await copy(shareText(pct));
    toast(ok ? 'COPIED TO CLIPBOARD' : 'COULD NOT COPY');
  };
  $('#shareBtn').onclick = async () => {
    const text = shareText(pct);
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch { /* cancelled */ }
    }
    const ok = await copy(text);
    toast(ok ? 'COPIED, PASTE IT ANYWHERE' : 'COULD NOT COPY');
  };
  $('#againBtn').onclick = () => startDive();
  $('#suggestForm').onsubmit = async (e) => {
    e.preventDefault();
    const v = $('#suggestInput').value.trim();
    if (v.length < 4) return;
    $('#suggestInput').value = '';
    const ok = await suggestPrompt(v);
    toast(ok ? 'THANKS! NOTED.' : 'SAVED LOCALLY. THANKS!');
  };
  refreshTitleMeta();
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(t), 1800);
}

function quitDive() {
  S.token++;
  clearInterval(S.timerId);
  S.sink = null;
  S.phase = 'title';
  ['#hud', '#promptCard', '#inputBar', '#countdown', '#sinkLabel', '#reveal', '#nextBtn', '#results'].forEach((s) => hide($(s)));
  world.mode = 'title';
  world.follow = false;
  world.clearTierLines();
  world.krill.attach = null;
  refreshTitleMeta();
  show($('#title'));
}

// ---------------------------------------------------------------- menu
function openMenu() {
  const avg = stats.played ? Math.round(stats.total / stats.played) : 0;
  $('#menuStats').innerHTML = stats.played
    ? `Dives: <b>${stats.played}</b> · Average: <b>${avg}</b> · Best: <b>${stats.best}</b><br>Today: <b>${stats.today.d === todayStr() ? stats.today.n : 0}</b> dives`
    : 'No dives yet. Go make some bubbles.';
  $('#menuQuit').classList.toggle('hidden', !['countdown', 'answering', 'sinking', 'reveal'].includes(S.phase));
  show($('#menu'));
}
$('#menuBtn').onclick = openMenu;
$('#menuClose').onclick = () => hide($('#menu'));
$('#menuSound').onclick = () => { sfx.setMuted(!sfx.isMuted()); updateMuteUI(); };
$('#muteBtn').onclick = () => { sfx.unlock(); sfx.setMuted(!sfx.isMuted()); updateMuteUI(); };
$('#menuQuit').onclick = () => { hide($('#menu')); quitDive(); };
$('#menuReset').onclick = () => {
  if (!confirm('Reset your dive stats on this device?')) return;
  Object.assign(stats, { played: 0, total: 0, best: 0, history: [], seen: [], diveNo: 0, today: { d: '', n: 0 } });
  saveStats();
  refreshTitleMeta();
  openMenu();
};

// ---------------------------------------------------------------- input
$('#startBtn').onclick = startDive;
$('#inputBar').onsubmit = (e) => { e.preventDefault(); submit(false); };
$('#nextBtn').onclick = next;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hide($('#menu'));
  if (e.key === 'Enter' && S.phase === 'reveal' && document.activeElement !== $('#nextBtn')) { e.preventDefault(); next(); }
  if (e.key === 'Enter' && S.phase === 'title' && !$('#menu').matches(':not(.hidden)') && document.activeElement?.tagName !== 'SUMMARY') {
    e.preventDefault(); startDive();
  }
});

// ---------------------------------------------------------------- loop
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (S.sink) {
    const k = Math.min(1, (now - S.sink.t0) / S.sink.dur);
    world.player = S.sink.from + (S.sink.to - S.sink.from) * ease(k);
    // tick as we pass each tier line
    for (const id of TIER_LINES) {
      const m = S.sink.from + TIERS[id].pts * M_PER_PT;
      if (!S.sink.passed.has(id) && world.player >= m - 0.5) {
        S.sink.passed.add(id);
        if (m < S.sink.to - 1) sfx.pass();
      }
    }
    if (Math.random() < 0.5) world.burst(world.W / 2 + (Math.random() - 0.5) * 200, labelY() - 10, 1, 20);
    if (k >= 1) {
      const done = S.sink.done;
      S.sink = null;
      done();
    }
  }

  world.update(dt);
  world.draw();

  if (!$('#sinkLabel').classList.contains('hidden')) positionLabel();
  if (S.phase !== 'title' && S.phase !== 'results') {
    $('#depthVal').textContent = fmtM(world.player);
    if (S.shownScore !== S.score) {
      S.shownScore += Math.sign(S.score - S.shownScore) * Math.max(1, Math.round(Math.abs(S.score - S.shownScore) * 0.12));
      $('#scoreVal').textContent = S.shownScore;
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
