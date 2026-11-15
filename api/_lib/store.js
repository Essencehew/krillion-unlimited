// Storage layer. Uses Supabase (via its REST API, no SDK needed) when
// SUPABASE_URL + SUPABASE_SECRET_KEY are set; otherwise an in-memory
// store so the game still works locally (data resets on restart).

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
// New-style secret key (sb_secret_...) or the legacy service_role key both work.
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
// New sb_ keys must only go in the apikey header; legacy JWT keys also go in Authorization.
const AUTH_HEADERS = KEY.startsWith('sb_') ? { apikey: KEY } : { apikey: KEY, Authorization: `Bearer ${KEY}` };

export const persistent = Boolean(URL_ && KEY);

async function sb(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      ...AUTH_HEADERS,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const enc = encodeURIComponent;

// ---------- in-memory fallback ----------
const mem = {
  answers: new Map(), // promptId -> Map(canonical -> {display,count,verdict})
  totals: new Map(),
  buckets: new Map(),
  suggestions: [],
};

const memStore = {
  async getAnswers(promptId) {
    const m = mem.answers.get(promptId) || new Map();
    const list = [...m.entries()].map(([canonical, v]) => ({ canonical, ...v }));
    list.sort((a, b) => b.count - a.count);
    return { answers: list.slice(0, 500), total: mem.totals.get(promptId) || 0 };
  },
  async getAnswer(promptId, canonical) {
    const v = mem.answers.get(promptId)?.get(canonical);
    return v ? { canonical, ...v } : null;
  },
  async submit(promptId, canonical, display, verdict, est) {
    if (!mem.answers.has(promptId)) mem.answers.set(promptId, new Map());
    const m = mem.answers.get(promptId);
    const cur = m.get(canonical) || { display, count: 0, verdict: null, est_pct: null };
    cur.count += 1;
    cur.verdict = cur.verdict || verdict || null;
    cur.est_pct = cur.est_pct ?? est ?? null;
    m.set(canonical, cur);
    const t = (mem.totals.get(promptId) || 0) + 1;
    mem.totals.set(promptId, t);
    return { answerCount: cur.count, promptTotal: t };
  },
  async recordScore(bucket) {
    mem.buckets.set(bucket, (mem.buckets.get(bucket) || 0) + 1);
  },
  async getBuckets() {
    return [...mem.buckets.entries()].map(([bucket, count]) => ({ bucket, count }));
  },
  async addSuggestion(text) {
    mem.suggestions.push({ text, at: Date.now() });
  },
};

// ---------- Supabase ----------
const sbStore = {
  async getAnswers(promptId) {
    const [answers, totals] = await Promise.all([
      sb(`answers?prompt_id=eq.${enc(promptId)}&select=canonical,display,count,verdict,est_pct&order=count.desc&limit=500`),
      sb(`prompt_totals?prompt_id=eq.${enc(promptId)}&select=total`),
    ]);
    return { answers: answers || [], total: totals?.[0]?.total || 0 };
  },
  async getAnswer(promptId, canonical) {
    const rows = await sb(
      `answers?prompt_id=eq.${enc(promptId)}&canonical=eq.${enc(canonical)}&select=canonical,display,count,verdict,est_pct`
    );
    return rows?.[0] || null;
  },
  async submit(promptId, canonical, display, verdict, est) {
    const rows = await sb('rpc/submit_answer', {
      method: 'POST',
      body: { p_prompt: promptId, p_canonical: canonical, p_display: display, p_verdict: verdict, p_est: est ?? null },
    });
    const r = Array.isArray(rows) ? rows[0] : rows;
    return { answerCount: r?.answer_count ?? 1, promptTotal: r?.prompt_total ?? 1 };
  },
  async recordScore(bucket) {
    await sb('rpc/record_score', { method: 'POST', body: { p_bucket: bucket } });
  },
  async getBuckets() {
    return (await sb('score_buckets?select=bucket,count&limit=200')) || [];
  },
  async addSuggestion(text) {
    await sb('suggestions', { method: 'POST', body: { text } });
  },
};

export const store = persistent ? sbStore : memStore;
