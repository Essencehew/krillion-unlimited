// Tiny synthesized sound effects (no audio files needed).

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('ku_muted') === '1'; } catch { /* storage blocked */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0 } = {}) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

export const sfx = {
  unlock() { ac(); },
  isMuted: () => muted,
  setMuted(v) {
    muted = v;
    try { localStorage.setItem('ku_muted', v ? '1' : '0'); } catch { /* ignore */ }
  },
  bubbles() {
    for (let i = 0; i < 5; i++) tone(300 + Math.random() * 500, 0.08, { vol: 0.12, slide: 400, delay: i * 0.05 });
  },
  click() { tone(660, 0.05, { type: 'square', vol: 0.06 }); },
  tick() { tone(1200, 0.04, { type: 'square', vol: 0.05 }); },
  countdown(n) { tone(n > 0 ? 520 : 880, 0.12, { type: 'triangle', vol: 0.15 }); },
  sink(seconds) { tone(220, seconds, { type: 'sine', vol: 0.1, slide: -160 }); },
  pass() { tone(900, 0.06, { type: 'triangle', vol: 0.06 }); },
  land(tier) {
    const notes = {
      outofair: [196], plankton: [330], clever: [392, 330], schooler: [440, 554],
      rare: [440, 554, 659], deepcut: [392, 494, 587, 784], krillion: [523, 659, 784, 1047, 1319],
    }[tier] || [440];
    notes.forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.16, delay: i * 0.09 }));
  },
  finish() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.14, delay: i * 0.12 })); },
};
