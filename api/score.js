// POST /api/score { score }  -> records a finished dive, returns the histogram
// GET  /api/score            -> histogram only
// Histogram buckets are 10 points wide: bucket = floor(score / 10).

import { store, persistent } from './_lib/store.js';
import { send, readBody, rateLimited } from './_lib/http.js';

const MAX_SCORE = 7 * 150;

export default async function handler(req, res) {
  if (req.method === 'POST') {
    if (rateLimited(req, 20)) return send(res, 429, { error: 'Slow down a little!' });
    const body = await readBody(req);
    const score = Math.round(Number(body.score));
    if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
      return send(res, 400, { error: 'Bad score' });
    }
    try {
      await store.recordScore(Math.floor(score / 10));
    } catch (e) {
      console.error('recordScore failed', e.message);
    }
  } else if (req.method !== 'GET') {
    return send(res, 405, { error: 'GET or POST' });
  }

  try {
    const rows = await store.getBuckets();
    const buckets = {};
    let games = 0;
    for (const r of rows) {
      buckets[r.bucket] = r.count;
      games += r.count;
    }
    return send(res, 200, { buckets, games, persisted: persistent });
  } catch (e) {
    console.error('getBuckets failed', e.message);
    return send(res, 200, { buckets: {}, games: 0, persisted: false });
  }
}
