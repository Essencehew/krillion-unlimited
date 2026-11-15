// Shared scoring logic (runs in the browser AND in the Vercel API).
// Rarity = how big a share of all divers gave the same answer.

// Virtual number of responses the seed estimates are worth. Real answers add on
// top, so after a few hundred real players per prompt, real data dominates.
export const SEED_POOL = 400;

export const TIERS = {
  outofair: { id: 'outofair', name: 'OUT OF AIR', pts: 0, color: '#7d8ea3', flavor: 'The clock ran out. You stayed put.', emoji: '🫧' },
  plankton: { id: 'plankton', name: 'PLANKTON', pts: 10, color: '#cfe3f0', flavor: 'Everybody said that. Drifting with the masses.', emoji: '⚪' },
  clever: { id: 'clever', name: 'TOO CLEVER', pts: 15, color: '#ffd166', flavor: "Nice try, smarty-fins. That one doesn't count.", emoji: '🃏' },
  schooler: { id: 'schooler', name: 'SCHOOLER', pts: 30, color: '#3ee0ff', flavor: 'Solid. You swim with the school.', emoji: '🐟' },
  rare: { id: 'rare', name: 'RARE', pts: 55, color: '#ff6b7d', flavor: 'Below the thermocline. Nice.', emoji: '🦐' },
  deepcut: { id: 'deepcut', name: 'DEEP CUT', pts: 85, color: '#a78bfa', flavor: 'Real obscurity. Few divers get this deep.', emoji: '🦑' },
  krillion: { id: 'krillion', name: 'ONE IN A KRILLION', pts: 150, color: '#ffd84d', flavor: 'Nobody, or almost nobody, said that. Trench dweller.', emoji: '🌟' },
};

// Tier lines drawn while sinking (order = depth order)
export const TIER_LINES = ['plankton', 'clever', 'schooler', 'rare', 'deepcut', 'krillion'];

// Metres sunk per point
export const M_PER_PT = 10;

// Share thresholds
const T_PLANKTON = 0.15;
const T_SCHOOLER = 0.035;
const T_RARE = 0.01;
const T_DEEP = 0.001;

// Final-score bands ("the bearing")
export const BEARING = [
  { min: 0, max: 150, tier: 'plankton', label: '0–150', text: 'Plankton. Plenty of ocean left down there.' },
  { min: 151, max: 250, tier: 'schooler', label: '151–250', text: 'Schooler. Safe in the shoal.' },
  { min: 251, max: 350, tier: 'rare', label: '251–350', text: 'Rare. Below the thermocline.' },
  { min: 351, max: 449, tier: 'deepcut', label: '351–449', text: 'Deep cut. Seriously deep dive.' },
  { min: 450, max: Infinity, tier: 'krillion', label: '450+', text: 'One in a krillion. Trench dweller. Absurd.' },
];

export function bearingFor(score) {
  return BEARING.find((b) => score >= b.min && score <= b.max) || BEARING[0];
}

// ---------- text normalisation ----------
const STOP = new Set(['the', 'a', 'an', 'my', 'your', 'some']);

export function normalize(raw) {
  let s = String(raw || '').toLowerCase();
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/['’`]/g, '');
  s = s.replace(/\+\+/g, ' plusplus ').replace(/\+/g, ' plus ').replace(/#/g, ' sharp ').replace(/&/g, ' and ');
  s = s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  let words = s.split(' ').filter(Boolean);
  if (words.length > 1) {
    const kept = words.filter((w) => !STOP.has(w));
    if (kept.length) words = kept;
  }
  words = words.map((w) =>
    w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w
  );
  return words.join(' ');
}

// Matching key: normalised, spaces removed ("spider man" == "spiderman")
export function keyOf(raw) {
  return normalize(raw).replace(/ /g, '');
}

export function prettyDisplay(raw) {
  const t = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!t) return t;
  if (/[A-Z]/.test(t)) return t; // already has capitals the player/seed chose
  return t[0].toUpperCase() + t.slice(1);
}

export function levenshtein(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function fuzzyLimit(len) {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  if (len <= 12) return 2;
  return 3;
}

// ---------- per-prompt index ----------
const indexCache = new Map();

export function promptIndex(prompt) {
  if (indexCache.has(prompt.id)) return indexCache.get(prompt.id);
  const byKey = new Map(); // key -> { key, display, pct }
  for (const s of prompt.seeds) {
    const k = keyOf(s.text);
    if (!k || byKey.has(k)) continue;
    byKey.set(k, { key: k, display: prettyDisplay(s.text), pct: s.pct });
  }
  const alias = new Map(); // aliasKey -> canonical key
  for (const a of prompt.aliases) {
    const to = keyOf(a.to);
    if (byKey.has(to)) alias.set(keyOf(a.from), to);
  }
  const idx = { byKey, alias };
  indexCache.set(prompt.id, idx);
  return idx;
}

/**
 * Match a raw answer to a canonical key.
 * existing: optional Map(key -> {display,count}) of answers real players gave.
 * Returns { key, display, seedPct, seeded, fuzzy }.
 */
export function resolveAnswer(prompt, raw, existing) {
  const idx = promptIndex(prompt);
  let key = keyOf(raw);
  const typedDisplay = prettyDisplay(raw);
  if (!key) return null;

  if (idx.alias.has(key)) key = idx.alias.get(key);

  const seedHit = (k) => {
    const s = idx.byKey.get(k);
    return s ? { key: k, display: s.display, seedPct: s.pct, seeded: true, fuzzy: false } : null;
  };

  // exact
  let hit = seedHit(key);
  if (hit) return hit;
  if (existing && existing.has(key)) {
    return { key, display: existing.get(key).display || typedDisplay, seedPct: 0, seeded: false, fuzzy: false };
  }

  // fuzzy (typos), seeds first then real answers, then aliases
  const lim = fuzzyLimit(key.length);
  if (lim > 0) {
    let best = null;
    let bestD = lim + 1;
    for (const k of idx.byKey.keys()) {
      const d = levenshtein(key, k, lim);
      if (d < bestD) { bestD = d; best = { k, src: 'seed' }; }
    }
    for (const [ak, to] of idx.alias) {
      const d = levenshtein(key, ak, lim);
      if (d < bestD) { bestD = d; best = { k: to, src: 'seed' }; }
    }
    if (existing) {
      for (const k of existing.keys()) {
        const d = levenshtein(key, k, lim);
        if (d < bestD) { bestD = d; best = { k, src: 'real' }; }
      }
    }
    if (best && bestD <= lim) {
      if (best.src === 'seed') return { ...seedHit(best.k), fuzzy: true };
      return { key: best.k, display: existing.get(best.k).display || typedDisplay, seedPct: 0, seeded: false, fuzzy: true };
    }
  }

  return { key, display: typedDisplay, seedPct: 0, seeded: false, fuzzy: false };
}

/**
 * Decide the tier.
 *  seedPct    estimated % from the seed list (0 if not seeded)
 *  realCount  how many OTHER real players gave this answer before
 *  realTotal  how many real answers this prompt had before
 *  valid      true (seeded / AI approved) | false (rejected) | null (unknown)
 */
export function classify({ seedPct = 0, realCount = 0, realTotal = 0, valid = null }) {
  if (valid === false) return { tier: 'clever', share: 0 };
  const seedCount = (seedPct / 100) * SEED_POOL;
  const share = (seedCount + realCount) / (SEED_POOL + realTotal);
  let tier;
  if (share >= T_PLANKTON) tier = 'plankton';
  else if (share >= T_SCHOOLER) tier = 'schooler';
  else if (share >= T_RARE) tier = 'rare';
  else if (share >= T_DEEP) tier = 'deepcut';
  else {
    // Top tier needs proof it's a real answer: AI-approved, or somebody else
    // independently gave the same answer before.
    tier = valid === true || realCount >= 1 ? 'krillion' : 'deepcut';
  }
  // Brand-new answer nobody could check (no AI key, never seen before):
  // cap it at RARE so random words can't farm deep points.
  if (valid === null && realCount === 0 && seedPct === 0 && (tier === 'deepcut' || tier === 'krillion')) {
    tier = 'rare';
  }
  return { tier, share };
}

// ---------- junk filter (used when no AI check is available) ----------
const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'rape', 'porn', 'dick', 'pussy', 'chutiya', 'madarchod', 'bhenchod', 'behenchod', 'gandu', 'randi'];
const MASH = ['asdf', 'sdfg', 'dfgh', 'fghj', 'ghjk', 'hjkl', 'qwer', 'wert', 'erty', 'rtyu', 'tyui', 'yuio', 'uiop', 'zxcv', 'xcvb', 'cvbn', 'vbnm', 'qazw', 'lkjh', 'poiu', 'mnbv'];

export function isProfane(raw) {
  const k = keyOf(raw);
  return BAD.some((w) => k.includes(w));
}

export function looksLikeJunk(raw) {
  const s = String(raw || '').toLowerCase().trim();
  const letters = s.replace(/[^a-z]/g, '');
  const digits = s.replace(/[^0-9]/g, '');
  if (letters.length + digits.length < 1) return true;
  if (letters.length === 0 && digits.length > 0) return digits.length > 4; // "100", "65" ok-ish
  if (/(.)\1\1\1/.test(letters)) return true;
  if (MASH.some((m) => letters.includes(m))) return true;
  for (const w of s.split(/[^a-z]+/).filter((x) => x.length >= 5)) {
    if (!/[aeiouy]/.test(w)) return true;
    if (/[bcdfghjklmnpqrstvwxz]{6,}/.test(w)) return true;
  }
  return false;
}

// Rough "how many other divers chose this" text
export function crowdText(realCount, realTotal, share) {
  if (realTotal >= 100) {
    return `${realCount.toLocaleString('en-US')} other diver${realCount === 1 ? '' : 's'} chose this`;
  }
  const pct = share * 100;
  if (pct <= 0) return 'no other divers chose this yet';
  if (pct < 0.5) return 'under 0.5% of divers chose this';
  return `≈${pct < 10 ? pct.toFixed(1) : Math.round(pct)}% of divers chose this`;
}
