// SVG charts for the results screen.

import { TIERS } from '../lib/scoring.js';
import { tierIconURL } from './sprites.js';

const MAX_X = 700;

// Everyone-else score distribution = real histogram + a gentle prior so the
// curve looks sensible before many people have played.
function combined(buckets) {
  const c = new Array(106).fill(0);
  const PRIOR_GAMES = 250, MEAN = 240, SD = 85;
  let norm = 0;
  const w = [];
  for (let b = 0; b < c.length; b++) {
    const x = b * 10 + 5;
    const v = Math.exp(-0.5 * ((x - MEAN) / SD) ** 2);
    w.push(v); norm += v;
  }
  for (let b = 0; b < c.length; b++) c[b] = (w[b] / norm) * PRIOR_GAMES;
  for (const [k, v] of Object.entries(buckets || {})) {
    const b = Number(k);
    if (b >= 0 && b < c.length) c[b] += Number(v) || 0;
  }
  return c;
}

export function percentile(buckets, score) {
  const c = combined(buckets);
  const mine = Math.min(c.length - 1, Math.floor(score / 10));
  let below = 0, total = 0;
  for (let b = 0; b < c.length; b++) {
    total += c[b];
    if (b < mine) below += c[b];
  }
  below += c[mine] * 0.5;
  return Math.max(1, Math.min(99, Math.round((below / total) * 100)));
}

export function distributionSVG(buckets, score) {
  const W = 460, H = 150, top = 12, bottom = 118;
  const c = combined(buckets);
  const xs = [];
  let maxY = 0;
  for (let x = 0; x <= MAX_X; x += 5) {
    let d = 0;
    for (let b = 0; b < c.length; b++) {
      const bx = b * 10 + 5;
      const dx = x - bx;
      if (Math.abs(dx) > 90) continue;
      d += c[b] * Math.exp(-0.5 * (dx / 26) ** 2);
    }
    xs.push([x, d]);
    if (d > maxY) maxY = d;
  }
  const px = (x) => (x / MAX_X) * W;
  const py = (d) => bottom - (d / maxY) * (bottom - top);
  let line = '';
  xs.forEach(([x, d], i) => { line += `${i ? 'L' : 'M'}${px(x).toFixed(1)},${py(d).toFixed(1)}`; });
  const area = `${line}L${W},${bottom}L0,${bottom}Z`;
  const sx = Math.min(MAX_X, Math.max(0, score));
  const nearest = xs.reduce((a, b) => (Math.abs(b[0] - sx) < Math.abs(a[0] - sx) ? b : a));
  const ys = py(nearest[1]);
  let ticks = '';
  for (let t = 0; t <= MAX_X; t += 100) {
    const tx = px(t);
    ticks += `<line x1="${tx}" y1="${bottom}" x2="${tx}" y2="${bottom + 4}" stroke="#3a5574"/>`;
    const near = Math.abs(t - sx) < 45;
    if (!near) ticks += `<text x="${tx}" y="${bottom + 17}" text-anchor="${t === 0 ? 'start' : t === MAX_X ? 'end' : 'middle'}">${t}</text>`;
  }
  return `<svg class="dist-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score distribution">
    <defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3ee0ff" stop-opacity=".55"/><stop offset="1" stop-color="#3ee0ff" stop-opacity=".04"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#dg)"/>
    <path d="${line}" fill="none" stroke="#3ee0ff" stroke-width="2"/>
    <line x1="0" y1="${bottom}" x2="${W}" y2="${bottom}" stroke="#3a5574"/>
    ${ticks}
    <line x1="${px(sx)}" y1="${ys}" x2="${px(sx)}" y2="${bottom}" stroke="#ff5c8a" stroke-width="2"/>
    <rect x="${px(sx) - 4}" y="${ys - 4}" width="8" height="8" fill="#ff5c8a"/>
    <text x="${px(sx)}" y="${bottom + 17}" text-anchor="middle" class="you">YOU</text>
  </svg>`;
}

export function diveLogSVG(rounds) {
  const W = 460, H = 280, left = 38, right = 450, top = 18, bottom = 248, MAXP = 150;
  const n = rounds.length || 7;
  const colW = (right - left) / n;
  const py = (p) => top + (p / MAXP) * (bottom - top);
  let grid = '';
  for (let p = 0; p <= MAXP; p += 25) {
    const y = py(p);
    grid += `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#1d3350" stroke-dasharray="3 4"/>`;
    grid += `<text x="${left - 6}" y="${y + 3}" text-anchor="end">${p ? -p : 0}</text>`;
  }
  let cols = '';
  rounds.forEach((r, i) => {
    const t = TIERS[r.tier];
    const x = left + colW * (i + 0.5);
    const y = py(Math.max(0, r.pts));
    cols += `<line x1="${x}" y1="${top}" x2="${x}" y2="${y}" stroke="${t.color}" stroke-opacity=".45" stroke-width="2"/>`;
    cols += `<image href="${tierIconURL(r.tier, 3)}" x="${x - 18}" y="${y - 14}" width="36" height="28" preserveAspectRatio="xMidYMid meet" style="image-rendering:pixelated;filter:drop-shadow(0 0 5px ${t.color})"><title>${escapeXml(r.display || '—')} · ${t.pts} pts</title></image>`;
    cols += `<text x="${x}" y="${H - 6}" text-anchor="middle">${i + 1}</text>`;
  });
  return `<svg class="log-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dive log">${grid}${cols}</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
