// Talks to the backend. If the backend can't be reached (e.g. opened as a
// static file), scores are worked out in the browser from the seed data.

import { PROMPT_BY_ID } from '../lib/prompts.js';
import {
  TIERS, classify, resolveAnswer, looksLikeJunk, isProfane, crowdText,
} from '../lib/scoring.js';

let offline = false;
export const isOffline = () => offline;

async function post(path, body, timeout = 9000) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok && res.status !== 400 && res.status !== 429) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (res.status === 429) throw new Error('rate');
  return data;
}

// ---------- local fallback ----------
function localCounts() {
  try { return JSON.parse(localStorage.getItem('ku_local_counts') || '{}'); } catch { return {}; }
}
function saveLocalCounts(c) {
  try { localStorage.setItem('ku_local_counts', JSON.stringify(c)); } catch { /* ignore */ }
}

function scoreLocally(promptId, answer) {
  const prompt = PROMPT_BY_ID[promptId];
  const t = (id, extra) => ({ tier: id, name: TIERS[id].name, pts: TIERS[id].pts, ...extra });
  const a = String(answer || '').trim();
  if (!a) return t('outofair', { display: '', crowd: '' });
  if (isProfane(a)) return t('clever', { display: a, crowd: 'keep it clean, diver' });
  const counts = localCounts();
  const pc = counts[promptId] || { total: 0, a: {} };
  const existing = new Map(Object.entries(pc.a).map(([k, v]) => [k, v]));
  const m = resolveAnswer(prompt, a, existing);
  if (!m.seeded && looksLikeJunk(a)) return t('clever', { display: m.display, crowd: "that doesn't quite fit the prompt" });
  // Local history is just you, so don't let it count as "other players"
  const { tier, share } = classify({ seedPct: m.seedPct, realCount: 0, realTotal: 0, valid: m.seeded ? true : null });
  pc.total += 1;
  pc.a[m.key] = { display: m.display, count: (pc.a[m.key]?.count || 0) + 1 };
  counts[promptId] = pc;
  saveLocalCounts(counts);
  return t(tier, { display: m.display, share, crowd: crowdText(0, 0, share), offline: true });
}

export async function submitAnswer(promptId, answer) {
  if (!offline) {
    try {
      return await post('/api/answer', { promptId, answer });
    } catch (e) {
      if (e.message !== 'rate') offline = true;
    }
  }
  return scoreLocally(promptId, answer);
}

export async function submitScore(score) {
  if (offline) return { buckets: {}, games: 0 };
  try {
    return await post('/api/score', { score }, 6000);
  } catch {
    return { buckets: {}, games: 0 };
  }
}

export async function suggestPrompt(text) {
  try {
    const r = await post('/api/suggest', { text }, 6000);
    return !!r.ok;
  } catch {
    return false;
  }
}
