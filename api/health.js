// GET /api/health — quick check that the backend is wired up.
import { persistent } from './_lib/store.js';
import { aiEnabled } from './_lib/ai.js';
import { send } from './_lib/http.js';

export default function handler(req, res) {
  send(res, 200, { ok: true, database: persistent ? 'supabase' : 'memory (not saved)', aiCheck: aiEnabled });
}
