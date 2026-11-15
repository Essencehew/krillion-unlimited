// POST /api/answer  { promptId, answer }
// Scores one answer by how rare it is among everyone who has played.

import { PROMPT_BY_ID } from '../lib/prompts.js';
import {
  TIERS, classify, resolveAnswer, looksLikeJunk, isProfane, crowdText, prettyDisplay,
} from '../lib/scoring.js';
import { store, persistent } from './_lib/store.js';
import { judgeAnswer, aiEnabled } from './_lib/ai.js';
import { send, readBody, rateLimited } from './_lib/http.js';

function result(tierId, extra = {}) {
  const t = TIERS[tierId];
  return { tier: tierId, name: t.name, pts: t.pts, ...extra };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (rateLimited(req, 60)) return send(res, 429, { error: 'Slow down a little!' });

  const body = await readBody(req);
  const prompt = PROMPT_BY_ID[String(body.promptId || '')];
  if (!prompt) return send(res, 400, { error: 'Unknown prompt' });

  const answer = String(body.answer || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!answer) return send(res, 200, result('outofair', { display: '', crowd: '' }));

  if (isProfane(answer)) {
    return send(res, 200, result('clever', { display: prettyDisplay(answer), crowd: 'keep it clean, diver' }));
  }

  // Real answers so far for this prompt
  let existing = new Map();
  let total = 0;
  let dbOk = true;
  try {
    const data = await store.getAnswers(prompt.id);
    total = data.total;
    for (const a of data.answers) existing.set(a.canonical, a);
  } catch (e) {
    console.error('getAnswers failed', e.message);
    dbOk = false;
  }

  let match = resolveAnswer(prompt, answer, existing);
  if (!match) return send(res, 200, result('outofair', { display: '', crowd: '' }));

  // Work out whether it's a legit answer
  let verdict = null;
  let est = null; // AI's popularity guess for answers missing from the seed list
  let aiChecked = false;
  const row = existing.get(match.key);
  if (match.seeded) verdict = 'valid';
  else if (row?.verdict) { verdict = row.verdict; est = row.est_pct ?? null; }
  else if (aiEnabled) {
    const j = await judgeAnswer(prompt.q, answer);
    if (j) {
      aiChecked = true;
      verdict = j.valid ? 'valid' : 'invalid';
      est = j.est;
      if (j.valid && j.canonical) {
        // Use the AI's standard name to merge alternate spellings
        const again = resolveAnswer(prompt, j.canonical, existing);
        if (again && (again.seeded || existing.has(again.key))) {
          match = again;
          if (again.seeded) est = null;
          else est = existing.get(again.key)?.est_pct ?? est;
        }
      }
    }
  }
  if (verdict === null && looksLikeJunk(answer)) verdict = 'invalid';

  if (verdict === 'invalid') {
    return send(res, 200, result('clever', {
      display: match.display, crowd: "that doesn't quite fit the prompt", aiChecked,
    }));
  }

  // Count it
  let realCount = existing.get(match.key)?.count || 0;
  let realTotal = total;
  if (dbOk) {
    try {
      const after = await store.submit(prompt.id, match.key, match.display, verdict, est);
      realCount = Math.max(0, after.answerCount - 1);
      realTotal = Math.max(0, after.promptTotal - 1);
    } catch (e) {
      console.error('submit failed', e.message);
      dbOk = false;
    }
  }

  const valid = verdict === 'valid' ? true : null;
  const seedPct = match.seeded ? match.seedPct : (est ?? 0);
  const { tier, share } = classify({ seedPct, realCount, realTotal, valid });

  return send(res, 200, result(tier, {
    display: match.display,
    realCount,
    realTotal,
    share,
    crowd: crowdText(realCount, realTotal, share),
    aiChecked,
    persisted: persistent && dbOk,
  }));
}
