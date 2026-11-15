// POST /api/suggest { text } — players suggest new prompts.
// Read them in Supabase → Table editor → suggestions.

import { store } from './_lib/store.js';
import { send, readBody, rateLimited } from './_lib/http.js';
import { isProfane } from '../lib/scoring.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (rateLimited(req, 5)) return send(res, 429, { error: 'Thanks! That is plenty for now.' });
  const body = await readBody(req);
  const text = String(body.text || '').trim().replace(/\s+/g, ' ').slice(0, 140);
  if (text.length < 4 || isProfane(text)) return send(res, 400, { error: 'Try a different suggestion' });
  try {
    await store.addSuggestion(text);
  } catch (e) {
    console.error('addSuggestion failed', e.message);
  }
  return send(res, 200, { ok: true });
}
