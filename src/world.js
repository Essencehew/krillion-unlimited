// The ocean: sky, surface, boat, depth-shaded water, kelp, fish, particles,
// depth ruler and the tier lines you sink past. Rendered on one canvas.

import { sprite, silhouette, TIER_ICON } from './sprites.js';
import { TIERS, TIER_LINES, M_PER_PT } from '../lib/scoring.js';

export const PPM = 2; // screen px per metre

const STOPS = [
  [0, [46, 108, 156]], [100, [36, 90, 134]], [300, [27, 69, 107]], [700, [19, 49, 80]],
  [1200, [13, 33, 58]], [2000, [9, 22, 42]], [3000, [6, 15, 31]], [5000, [4, 10, 21]],
  [8000, [3, 6, 13]], [11000, [2, 3, 8]],
];

function colorAt(m) {
  if (m <= 0) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [m1, c1] = STOPS[i];
    const [m0, c0] = STOPS[i - 1];
    if (m <= m1) {
      const t = (m - m0) / (m1 - m0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const snap = (v, g = 2) => Math.round(v / g) * g;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONES = [
  { m: 50, label: 'THE SUNLIGHT ZONE' },
  { m: 220, label: 'THE TWILIGHT ZONE' },
  { m: 1020, label: 'THE MIDNIGHT ZONE' },
  { m: 3020, label: 'THE ABYSSAL ZONE' },
  { m: 6020, label: 'THE HADAL ZONE' },
];
const FACTS = [
  { m: 180, t: 'sunlight starts to give out' },
  { m: 530, t: 'emperor penguins dive this deep' },
  { m: 1000, t: 'the last of the light is gone' },
  { m: 1600, t: 'sperm whales hunt giant squid here' },
  { m: 2400, t: 'the water is near freezing and black' },
  { m: 3800, t: 'the Titanic rests at about this depth' },
  { m: 5000, t: 'pressure: ~500x the surface' },
  { m: 8849, t: 'deeper than Everest is tall' },
  { m: 10935, t: 'Challenger Deep. The bottom.' },
];

function makeCloud(rng) {
  const g = 8;
  const w = (14 + Math.floor(rng() * 16)) * g;
  const h = (5 + Math.floor(rng() * 4)) * g;
  const c = document.createElement('canvas');
  c.width = w; c.height = h + g;
  const x = c.getContext('2d');
  const blobs = 4 + Math.floor(rng() * 4);
  const rects = [];
  for (let i = 0; i < blobs; i++) {
    const bw = snap((0.25 + rng() * 0.4) * w, g);
    const bh = snap((0.35 + rng() * 0.6) * h, g);
    const bx = snap(rng() * (w - bw), g);
    rects.push([bx, h - bh, bw, bh]);
  }
  rects.push([0, h - g * 2, w, g * 2]);
  x.fillStyle = '#d9ecf6';
  for (const [a, b, cw, ch] of rects) x.fillRect(a, b + g * 0.6, cw, ch);
  x.fillStyle = '#ffffff';
  for (const [a, b, cw, ch] of rects) x.fillRect(a, b, cw, ch - g);
  return c;
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.cam = -80;
    this.player = 0;
    this.mode = 'title';
    this.follow = false;
    this.tier = null; // { start, landed }
    this.bubbles = [];
    this.fish = [];
    this.jellies = [];
    this.krill = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, retarget: 0, attach: null, face: -1 };
    this.resize();
    window.addEventListener('resize', () => this.resize());

    const rng = mulberry32(7);
    this.clouds = Array.from({ length: 8 }, (_, i) => ({
      img: makeCloud(rng),
      x: rng() * 1.3 - 0.15,
      alt: 160 + rng() * 520,
      speed: 4 + rng() * 6,
      far: i % 2 === 0,
    }));
    this.snow = Array.from({ length: 110 }, () => ({
      x: Math.random(), y: Math.random(), z: 0.25 + Math.random() * 0.9, s: Math.random() < 0.15 ? 2 : 1,
    }));
    this.glow = Array.from({ length: 30 }, () => ({
      x: Math.random(), y: Math.random(), z: 0.4 + Math.random() * 0.8, ph: Math.random() * 6.28,
    }));
    this.krill.x = this.W * 0.7;
    this.krill.y = this.H * 0.75;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.floor(this.W * dpr);
    this.canvas.height = Math.floor(this.H * dpr);
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  // camera position where the surface sits at a given fraction of the screen
  camForSurfaceAt(frac) { return (this.H * 0.5 - this.H * frac) / PPM; }
  get titleCam() { return this.camForSurfaceAt(this.W < 700 ? 0.66 : 0.62); }
  get gameMinCam() { return this.camForSurfaceAt(0.27); }

  y(m) { return this.H * 0.5 + (m - this.cam) * PPM; }
  depthAtY(y) { return this.cam + (y - this.H * 0.5) / PPM; }

  burst(x, y, n = 12, spread = 30) {
    const m = this.depthAtY(y);
    for (let i = 0; i < n; i++) {
      this.bubbles.push({
        x: x + (Math.random() - 0.5) * spread,
        m: m + (Math.random() - 0.5) * (spread / PPM),
        r: 1.5 + Math.random() * 3.5,
        vy: 18 + Math.random() * 40,
        wob: Math.random() * 6.28,
        life: 1.6 + Math.random() * 1.8,
      });
    }
  }

  startTierLines(start) { this.tier = { start, landed: null }; }
  landTier(id) { if (this.tier) this.tier.landed = id; }
  clearTierLines() { this.tier = null; }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.t += dt;
    const W = this.W, H = this.H;

    let target;
    if (this.mode === 'game') target = Math.max(this.player, this.gameMinCam);
    else target = this.titleCam;
    const k = this.follow ? 10 : this.mode === 'results' ? 2.2 : 3;
    this.cam += (target - this.cam) * (1 - Math.exp(-dt * k));

    // clouds drift
    for (const c of this.clouds) {
      c.x += (c.speed * dt) / W;
      if (c.x > 1.15) c.x = -0.35;
    }

    // snow drifts down slowly
    for (const s of this.snow) {
      s.y += (dt * 0.006 * s.z);
      if (s.y > 1) s.y -= 1;
    }

    // bubbles
    for (const b of this.bubbles) {
      b.m -= b.vy * dt;
      b.wob += dt * 4;
      b.life -= dt;
    }
    this.bubbles = this.bubbles.filter((b) => b.life > 0 && b.m > 0);
    if (this.bubbles.length > 400) this.bubbles.splice(0, this.bubbles.length - 400);

    this.updateFish(dt);
    this.updateKrill(dt);
  }

  updateFish(dt) {
    const W = this.W, H = this.H;
    const viewTop = this.depthAtY(0), viewBot = this.depthAtY(H);
    for (const f of this.fish) f.x += f.dir * f.speed * dt;
    this.fish = this.fish.filter((f) => f.x > -300 && f.x < W + 300 && Math.abs(f.m - this.cam) < H * 1.2 / PPM);
    const want = this.mode === 'title' ? 5 : 4;
    if (this.fish.length < want && Math.random() < dt * 1.5) {
      const lo = Math.max(12, viewTop);
      const hi = Math.min(3200, viewBot);
      if (hi > lo + 20) {
        const m = lo + Math.random() * (hi - lo);
        const dir = Math.random() < 0.5 ? -1 : 1;
        const glowing = m > 700 && Math.random() < 0.45;
        const n = glowing ? 1 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 7);
        const offs = Array.from({ length: n }, () => ({ dx: Math.random() * 140 - 70, dy: Math.random() * 40 - 20, ph: Math.random() * 6 }));
        this.fish.push({
          m, dir, glowing, offs,
          x: dir > 0 ? -150 : W + 150,
          speed: 25 + Math.random() * 45,
          scale: glowing ? 2 : Math.random() < 0.3 ? 3 : 2,
        });
      }
    }
    // deep jellies
    for (const j of this.jellies) { j.m += Math.sin(this.t * 0.6 + j.ph) * dt * 3 - dt * 2; j.x += Math.sin(this.t * 0.3 + j.ph) * dt * 6; }
    this.jellies = this.jellies.filter((j) => Math.abs(j.m - this.cam) < H * 1.3 / PPM);
    if (this.jellies.length < 2 && viewBot > 1300 && Math.random() < dt * 0.4) {
      const m = Math.max(1300, viewTop) + Math.random() * (viewBot - Math.max(1300, viewTop));
      this.jellies.push({ m, x: W * (0.08 + Math.random() * 0.84), ph: Math.random() * 6, hue: Math.random() < 0.5 ? '255,107,142' : '167,139,250', size: 3 + Math.floor(Math.random() * 2) });
    }
  }

  updateKrill(dt) {
    const K = this.krill, W = this.W, H = this.H;
    if (K.attach) {
      const p = K.attach();
      K.tx = p.x; K.ty = p.y;
    } else {
      K.retarget -= dt;
      const surfaceY = this.y(0);
      const top = Math.max(surfaceY + 40, 110);
      const bot = H - (this.mode === 'game' ? 150 : 110);
      if (K.retarget <= 0 || K.ty < top || K.ty > bot) {
        K.retarget = 2.5 + Math.random() * 4;
        // in-game, keep to the sides so it doesn't cover the text in the middle
        K.tx = this.mode === 'game'
          ? W * (Math.random() < 0.5 ? 0.06 + Math.random() * 0.2 : 0.74 + Math.random() * 0.18)
          : W * (0.08 + Math.random() * 0.84);
        K.ty = top + Math.random() * Math.max(10, bot - top);
      }
    }
    const stiff = K.attach ? 9 : 1.4;
    const ax = (K.tx - K.x) * stiff - K.vx * (K.attach ? 5 : 1.6);
    const ay = (K.ty - K.y) * stiff - K.vy * (K.attach ? 5 : 1.6);
    K.vx += ax * dt; K.vy += ay * dt;
    K.x += K.vx * dt; K.y += K.vy * dt;
    if (Math.abs(K.vx) > 8) K.face = K.vx > 0 ? 1 : -1;
    if (Math.random() < dt * (K.attach ? 6 : 0.8)) this.burst(K.x + (K.face > 0 ? -10 : 10), K.y, 1, 6);
  }

  // ---------------------------------------------------------------- draw
  draw() {
    const ctx = this.ctx, W = this.W, H = this.H;
    const mTop = this.depthAtY(0), mBot = this.depthAtY(H);

    // water
    const g = ctx.createLinearGradient(0, 0, 0, H);
    for (let i = 0; i <= 5; i++) {
      const m = mTop + ((mBot - mTop) * i) / 5;
      g.addColorStop(i / 5, rgb(colorAt(Math.max(0, m))));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    this.drawRays(mTop);
    this.drawSilhouettes(mTop, mBot, 0.55, 0.22);
    this.drawGlow(mTop);
    this.drawFish();
    this.drawJellies();
    this.drawSilhouettes(mTop, mBot, 1, 0.42);
    this.drawSky();
    this.drawSnow();
    this.drawBubbles();
    this.drawZones(mTop, mBot);
    this.drawTierLines();
    this.drawRuler(mTop, mBot);
    this.drawKrill();
  }

  drawSky() {
    const ctx = this.ctx, W = this.W;
    const y0 = this.y(0);
    if (y0 < -10) return;
    const t = this.t;
    const waveY = (x) => y0 + snap(Math.sin(x * 0.011 + t * 1.3) * 2.2 + Math.sin(x * 0.029 - t * 0.9) * 1.6, 2);

    // sky
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(W, -2);
    for (let x = W; x >= 0; x -= 6) ctx.lineTo(x, waveY(x));
    ctx.closePath();
    const sg = ctx.createLinearGradient(0, y0 - 900, 0, y0);
    sg.addColorStop(0, '#9ccbe4');
    sg.addColorStop(0.55, '#c3e2f1');
    sg.addColorStop(1, '#e6f3f9');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.clip();
    // sun glow
    const sx = W * 0.86, sy = y0 - 760;
    const sun = ctx.createRadialGradient(sx, sy, 10, sx, sy, Math.max(420, W * 0.35));
    sun.addColorStop(0, 'rgba(255,240,185,0.95)');
    sun.addColorStop(0.25, 'rgba(255,236,170,0.45)');
    sun.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, y0);
    // clouds
    for (const c of this.clouds) {
      const cy = snap(y0 - c.alt - c.img.height, 2);
      if (cy > y0 - 30 || cy + c.img.height < 0) continue;
      ctx.globalAlpha = c.far ? 0.75 : 1;
      ctx.drawImage(c.img, snap(c.x * W, 2), cy);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // surface highlight
    ctx.fillStyle = 'rgba(205,232,246,0.55)';
    for (let x = 0; x < W; x += 6) ctx.fillRect(x, waveY(x), 6, 2);
    ctx.fillStyle = 'rgba(120,175,210,0.35)';
    for (let x = 0; x < W; x += 6) ctx.fillRect(x, waveY(x) + 6, 6, 2);

    // boat
    const boat = sprite('boat', 'boat', this.W < 700 ? 3 : 4);
    const bx = snap(W * (this.W < 700 ? 0.12 : 0.25), 2);
    const bob = snap(Math.sin(t * 1.4) * 2, 2);
    ctx.drawImage(boat, bx, snap(y0 - boat.height + boat.height * 0.27 + bob, 2));
  }

  drawRays(mTop) {
    if (mTop > 650) return;
    const ctx = this.ctx, W = this.W;
    const y0 = Math.max(this.y(0), -50);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const base = ((i / 6) * W * 1.4 + Math.sin(this.t * 0.15 + i) * 60) - W * 0.1;
      const len = 700;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
      g.addColorStop(0, 'rgba(160,210,240,0.07)');
      g.addColorStop(1, 'rgba(160,210,240,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(base, y0);
      ctx.lineTo(base + 70, y0);
      ctx.lineTo(base + 70 - 260, y0 + len);
      ctx.lineTo(base - 260 - 40, y0 + len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawSilhouettes(mTop, mBot, parallax, alpha) {
    const ctx = this.ctx, W = this.W, H = this.H;
    // Parallax: far layer appears to move slower than the camera
    const camP = this.cam * parallax;
    const toY = (m) => H * 0.5 + (m - camP) * PPM;
    const topP = camP - H / 2 / PPM, botP = camP + H / 2 / PPM;
    const SEG = 240;
    const startDepth = 650;
    for (let s = Math.floor(topP / SEG) - 1; s <= Math.floor(botP / SEG) + 1; s++) {
      const segM = s * SEG;
      if (segM / parallax < startDepth) continue;
      const fade = clamp((segM / parallax - startDepth) / 500, 0, 1);
      const rng = mulberry32(s * 977 + (parallax < 1 ? 31 : 7));
      const col = parallax < 1 ? `rgba(40,80,130,${alpha * fade})` : `rgba(24,52,90,${alpha * fade})`;
      ctx.fillStyle = col;
      for (const side of [-1, 1]) {
        if (rng() < 0.55) {
          // rock pillar
          const w = 50 + rng() * (parallax < 1 ? 160 : 110);
          const hgt = 160 + rng() * 520;
          const edge = rng() * W * 0.14;
          const baseY = toY(segM + SEG * rng());
          const r2 = mulberry32(s * 13 + side * 101);
          for (let yy = 0; yy < hgt; yy += 12) {
            const shrink = (yy / hgt) * (0.35 + r2() * 0.2);
            const ww = snap(w * (1 - shrink) + (r2() - 0.5) * 14, 6);
            const x = side < 0 ? snap(edge, 6) : snap(W - edge - ww, 6);
            const yP = snap(baseY - yy, 6);
            if (yP < -20 || yP > H + 20) continue;
            ctx.fillRect(x, yP, ww, 12);
          }
        }
        const kelps = Math.floor(rng() * 3);
        for (let kI = 0; kI < kelps; kI++) {
          const kx = side < 0 ? rng() * W * 0.22 : W - rng() * W * 0.22;
          const baseY = toY(segM + SEG * rng());
          const hgt = 120 + rng() * 360;
          const seed = rng() * 6;
          for (let i = 0, yy = 0; yy < hgt; yy += 8, i++) {
            const sway = Math.sin(this.t * 0.9 + i * 0.32 + seed) * i * 0.55;
            const x = snap(kx + sway, 4);
            const yP = snap(baseY - yy, 4);
            if (yP < -20 || yP > H + 20) continue;
            ctx.fillRect(x, yP, 8, 8);
            if (i % 4 === 1) ctx.fillRect(x + (i % 8 === 1 ? 8 : -12), yP - 4, 12, 6);
          }
        }
      }
    }
  }

  drawGlow(mTop) {
    const strength = clamp((mTop - 350) / 700, 0, 1);
    if (strength <= 0) return;
    const ctx = this.ctx, W = this.W, H = this.H;
    for (const p of this.glow) {
      const yy = ((p.y * H - this.cam * PPM * p.z) % H + H) % H;
      const a = strength * (0.35 + 0.45 * Math.sin(this.t * 1.7 + p.ph) ** 2) * (yy > this.y(0) ? 1 : 0);
      ctx.fillStyle = `rgba(62,224,210,${a})`;
      ctx.fillRect(snap(p.x * W, 2), snap(yy, 2), 3, 3);
    }
  }

  drawSnow() {
    const ctx = this.ctx, W = this.W, H = this.H;
    const y0 = this.y(0);
    const deep = clamp(this.cam / 1500, 0, 1);
    for (const s of this.snow) {
      const yy = ((s.y * H - this.cam * PPM * s.z) % H + H) % H;
      if (yy < y0 + 4) continue;
      ctx.fillStyle = `rgba(190,215,235,${(0.12 + 0.25 * s.z) * (0.6 + deep * 0.4)})`;
      ctx.fillRect(snap(s.x * W, 2), snap(yy, 2), s.s * 2, s.s * 2);
    }
  }

  drawFish() {
    const ctx = this.ctx;
    for (const f of this.fish) {
      const baseY = this.y(f.m);
      if (baseY < -80 || baseY > this.H + 80 || baseY < this.y(0) + 10) continue;
      const flip = f.dir > 0;
      if (f.glowing) {
        const img = sprite('schooler', 'schooler', f.scale, flip);
        ctx.save();
        ctx.shadowColor = '#3ee0ff';
        ctx.shadowBlur = 14;
        ctx.globalAlpha = 0.85;
        for (const o of f.offs) ctx.drawImage(img, snap(f.x + o.dx, 2), snap(baseY + o.dy + Math.sin(this.t * 2 + o.ph) * 3, 2));
        ctx.restore();
      } else {
        const depthDark = clamp(f.m / 900, 0, 1);
        const col = `rgba(${Math.round(8 - depthDark * 4)},${Math.round(25 - depthDark * 12)},${Math.round(45 - depthDark * 20)},0.75)`;
        const img = silhouette('fish', col, f.scale, flip);
        for (const o of f.offs) ctx.drawImage(img, snap(f.x + o.dx, 2), snap(baseY + o.dy + Math.sin(this.t * 2 + o.ph) * 2, 2));
      }
    }
  }

  drawJellies() {
    const ctx = this.ctx;
    for (const j of this.jellies) {
      const y = this.y(j.m);
      if (y < -60 || y > this.H + 60) continue;
      const s = j.size, x = snap(j.x, s);
      const pulse = Math.sin(this.t * 2 + j.ph);
      ctx.save();
      ctx.shadowColor = `rgba(${j.hue},0.9)`;
      ctx.shadowBlur = 16;
      ctx.fillStyle = `rgba(${j.hue},0.55)`;
      const bell = [[2, 0, 4], [1, 1, 6], [0, 2, 8], [0, 3, 8]];
      for (const [dx, dy, w] of bell) ctx.fillRect(x + dx * s, snap(y, s) + dy * s, w * s, s);
      ctx.fillStyle = `rgba(${j.hue},0.35)`;
      for (let tI = 0; tI < 4; tI++) {
        for (let k = 0; k < 5; k++) {
          const sway = Math.round(Math.sin(this.t * 2.4 + k * 0.7 + tI) * (k / 3));
          ctx.fillRect(x + (1 + tI * 2 + sway) * s, snap(y, s) + (4 + k + (pulse > 0 ? 0 : 1)) * s, s, s);
        }
      }
      ctx.restore();
    }
  }

  drawBubbles() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(200,230,250,0.6)';
    ctx.lineWidth = 1;
    for (const b of this.bubbles) {
      const y = this.y(b.m);
      if (y < this.y(0) || y > this.H + 10) continue;
      ctx.globalAlpha = clamp(b.life, 0, 1) * 0.8;
      ctx.beginPath();
      ctx.arc(b.x + Math.sin(b.wob) * 3, y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawZones(mTop, mBot) {
    const ctx = this.ctx, W = this.W;
    const small = W < 700;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = `${small ? 10 : 13}px Silkscreen, monospace`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = small ? '2px' : '4px';
    for (const z of ZONES) {
      if (z.m < mTop - 50 || z.m > mBot + 50) continue;
      const y = this.y(z.m);
      ctx.fillStyle = 'rgba(62,224,255,0.42)';
      ctx.fillRect(small ? 12 : 60, y, small ? 14 : 26, 2);
      ctx.textAlign = 'left';
      ctx.fillText(z.label, small ? 32 : 98, y + 1);
    }
    ctx.font = `${small ? 9 : 11}px "Space Mono", monospace`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    for (const f of FACTS) {
      if (f.m < mTop - 50 || f.m > mBot + 50 || small) continue;
      const y = this.y(f.m);
      ctx.fillStyle = 'rgba(200,222,240,0.32)';
      ctx.textAlign = 'right';
      ctx.fillText(f.t, W - 96, y);
      ctx.fillRect(W - 88, y, 26, 1);
    }
    ctx.restore();
  }

  drawTierLines() {
    if (!this.tier) return;
    const ctx = this.ctx, W = this.W, H = this.H;
    const L = Math.min(820, W * 0.88);
    const x0 = (W - L) / 2;
    const py = this.y(this.player);
    ctx.save();
    ctx.font = `${W < 700 ? 9 : 11}px "Space Mono", monospace`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    for (const id of TIER_LINES) {
      const t = TIERS[id];
      const m = this.tier.start + t.pts * M_PER_PT;
      const y = snap(this.y(m), 2);
      if (y < -30 || y > H + 30) continue;
      const near = 1 - clamp(Math.abs(y - py) / (H * 0.55), 0, 1);
      let a = 0.18 + 0.6 * near;
      let color = id === 'clever' ? 'rgba(255,209,102,A)' : 'rgba(205,225,240,A)';
      let lw = 2;
      const landed = this.tier.landed;
      if (landed) {
        if (id === landed) { a = 1; color = hexA(t.color); lw = 2; }
        else a *= 0.35;
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color.replace('A', a.toFixed(3));
      ctx.lineWidth = lw;
      ctx.setLineDash([8, 6]);
      if (landed === id) { ctx.shadowColor = t.color; ctx.shadowBlur = 10; }
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + L, y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
      ctx.fillStyle = (landed === id ? hexA(t.color) : color).replace('A', Math.min(1, a + 0.1).toFixed(3));
      const label = `${id === 'krillion' ? 'KRILLION' : t.name} · ${t.pts}`;
      ctx.fillText(label, x0 + L, y - 5);
      const [gname, pname] = TIER_ICON[id];
      const icon = sprite(gname, pname, 2);
      const tw = ctx.measureText(label).width;
      ctx.globalAlpha = Math.min(1, a + 0.1);
      ctx.drawImage(icon, snap(x0 + L - tw - icon.width - 8, 2), snap(y - 4 - icon.height, 2));
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  drawRuler(mTop, mBot) {
    const ctx = this.ctx, W = this.W, H = this.H;
    const x = W - 10;
    ctx.save();
    ctx.fillStyle = 'rgba(170,205,230,0.18)';
    ctx.fillRect(x, 0, 1, H);
    ctx.font = '9px "Space Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const start = Math.max(0, Math.floor(mTop / 20) * 20);
    for (let m = start; m <= mBot; m += 20) {
      const y = snap(this.y(m), 1);
      const major = m % 100 === 0;
      ctx.fillStyle = `rgba(170,205,230,${major ? 0.35 : 0.2})`;
      ctx.fillRect(x - (major ? 12 : 5), y, major ? 12 : 5, 1);
      if (major && W > 500) {
        ctx.fillStyle = 'rgba(170,205,230,0.32)';
        ctx.fillText(m === 0 ? '0m' : `-${m.toLocaleString('en-US')}m`, x - 16, y);
      }
    }
    if (this.mode === 'game') {
      const y = snap(this.y(this.player), 1);
      if (y > 0 && y < H) {
        ctx.fillStyle = '#ff5c8a';
        ctx.fillRect(x - 40, y, 40, 2);
        ctx.beginPath();
        ctx.moveTo(x - 2, y + 1); ctx.lineTo(x + 8, y - 5); ctx.lineTo(x + 8, y + 7); ctx.closePath();
        ctx.fill();
        ctx.font = '9px "Space Mono", monospace';
        ctx.fillText('YOU', x - 46, y + 1);
      }
    }
    ctx.restore();
  }

  drawKrill() {
    const ctx = this.ctx, K = this.krill;
    const img = sprite('krill', 'krill', 3, K.face > 0);
    const bob = Math.sin(this.t * 3) * 2;
    ctx.save();
    ctx.shadowColor = 'rgba(255,60,110,0.95)';
    ctx.shadowBlur = 22;
    ctx.drawImage(img, snap(K.x - img.width / 2, 2), snap(K.y - img.height / 2 + bob, 2));
    ctx.shadowBlur = 8;
    ctx.drawImage(img, snap(K.x - img.width / 2, 2), snap(K.y - img.height / 2 + bob, 2));
    ctx.restore();
  }
}

function hexA(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},A)`;
}
