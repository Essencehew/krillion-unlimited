// Pixel-art sprites drawn from text grids. '.' = transparent.

const pad = (s, w) => s.padEnd(w, '.');
const rep = (c, n) => c.repeat(n);

function boatGrid() {
  const W = 46;
  const rows = [
    rep('.', 13) + 'pppppp' + 'k',
    rep('.', 11) + 'pppppppP' + 'k',
    rep('.', 13) + 'ppppPP' + 'k',
    rep('.', 15) + 'pppP' + 'k',
    rep('.', 19) + 'k',
    rep('.', 19) + 'k',
    rep('.', 19) + 'k',
    rep('.', 19) + 'k',
    rep('.', 14) + rep('k', 12),
    rep('.', 14) + rep('k', 12),
    rep('.', 14) + 'kkwwkkwwkkkk',
    rep('.', 14) + 'kkwwkkwwkkkk',
    rep('.', 14) + rep('k', 12),
    rep('.', 10) + rep('k', 28),
    'kkkk' + rep('.', 6) + rep('k', 28) + rep('k', 8),
    rep('k', 46),
  ];
  for (let i = 1; i <= 5; i++) rows.push(rep('.', i) + rep('k', W - i * 2 - (i > 2 ? 1 : 0)));
  return rows.map((r) => pad(r, W));
}

const GRIDS = {
  boat: boatGrid(),
  krill: [
    'a.a.........',
    '.a.a........',
    '..aa.rrrr...',
    '....rllrrr..',
    '...relrrrrr.',
    '...rrrrrrdr.',
    '....rrrrrdr.',
    '...d.rrrrdr.',
    '..d..rrrdr..',
    '....d.rdr...',
    '.....rrr....',
    '....rr.rr...',
  ],
  schooler: [
    '....cccc.....',
    '..cccccccc..c',
    '.cecccCccccc.',
    'cccccccccccc.',
    '.cccccccCccc.',
    '..cccccccc..c',
    '....cccc.....',
  ],
  angler: [
    '....y...........',
    '...yy.d.........',
    '....d..d........',
    '.......dddddd...',
    '....dddddddddd.d',
    '...dewdddddddddd',
    '..dddddddddddddd',
    '..dwdwdwdddddddd',
    '...ddddddddddd.d',
    '....dddddddd....',
    '......dddd......',
  ],
  seahorse: [
    '..yyy...',
    '.yyyyy..',
    '.yeyyyyy',
    '..yyy...',
    '..yyyy..',
    '...yyyy.',
    '...yyyy.',
    '..yyyy..',
    '..yyy...',
    '...yy...',
    '....y.y.',
    '.....y..',
  ],
  jelly: [
    '...rrrr...',
    '.rrrrrrrr.',
    'rrllrrrrrr',
    'rlrrrrrrrr',
    'rrrrrrrrrr',
    '.r.r.r.r..',
    '.r..r.r.r.',
    '..r.r..r..',
    '.r..r.r...',
    '..r..r..r.',
    '.r..r..r..',
    '....r.....',
  ],
  plankton: [
    '..o......',
    '.....o...',
    'o..o...o.',
    '...ooo...',
    '.o..o..o.',
    '....o....',
    '..o...o..',
    'o.......o',
    '....o....',
  ],
  bubble: [
    '..ooooo..',
    '.o.....o.',
    'o..ll...o',
    'o.l.....o',
    'o.......o',
    'o.......o',
    'o.......o',
    '.o.....o.',
    '..ooooo..',
  ],
  fish: [
    '..kkk..k',
    '.kkkkkkk',
    'kkkkkkk.',
    '.kkkkkkk',
    '..kkk..k',
  ],
  puffer: [
    '...y.y.y...',
    '..yyyyyyy..',
    '.yyyyyyyyy.',
    'yyewyyyyyyy',
    'yyyyyyyyyy.',
    'yyyyyoyyyyy',
    '.yyyyyyyyy.',
    '..yyyyyyy..',
    '...y.y.y...',
  ],
};

const PALETTES = {
  boat: { k: '#0c1726', w: '#3d6b8a', p: '#ff6b8e', P: '#d94f73' },
  krill: { r: '#ff4774', l: '#ffa3bb', d: '#c22452', e: '#2a0812', a: '#ff7c9c' },
  krillGold: { r: '#ffcf3d', l: '#fff3b0', d: '#c9921a', e: '#3a2600', a: '#ffe27a' },
  schooler: { c: '#3ee0ff', C: '#1aa6c9', e: '#06222c' },
  angler: { d: '#5a5f9a', e: '#f2f2ff', w: '#dfe3ff', y: '#fff7b0' },
  seahorse: { y: '#ffd166', e: '#3a2600' },
  jelly: { r: '#ff6b7d', l: '#ffc2ca' },
  plankton: { o: '#cfe3f0' },
  bubble: { o: '#9fb3c8', l: '#e6f1fa' },
  puffer: { y: '#f2c14e', e: '#111', w: '#fff', o: '#c98d1a' },
};

const cache = new Map();

export function sprite(name, paletteName = name, scale = 3, flip = false) {
  const id = `${name}|${paletteName}|${scale}|${flip}`;
  if (cache.has(id)) return cache.get(id);
  const grid = GRIDS[name];
  const pal = typeof paletteName === 'string' ? PALETTES[paletteName] : paletteName;
  const h = grid.length;
  const w = grid[0].length;
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = grid[y][x];
      if (ch === '.' || !pal[ch]) continue;
      g.fillStyle = pal[ch];
      const dx = flip ? w - 1 - x : x;
      g.fillRect(dx * scale, y * scale, scale, scale);
    }
  }
  cache.set(id, c);
  return c;
}

// Solid-colour silhouette (for background fish)
export function silhouette(name, color, scale = 3, flip = false) {
  const grid = GRIDS[name];
  const pal = {};
  for (const row of grid) for (const ch of row) if (ch !== '.') pal[ch] = color;
  return sprite(name, pal, scale, flip);
}

// Creature icon for each tier
export const TIER_ICON = {
  outofair: ['bubble', 'bubble'],
  plankton: ['plankton', 'plankton'],
  clever: ['seahorse', 'seahorse'],
  schooler: ['schooler', 'schooler'],
  rare: ['jelly', 'jelly'],
  deepcut: ['angler', 'angler'],
  krillion: ['krill', 'krillGold'],
};

const urlCache = new Map();
export function tierIconURL(tier, scale = 4) {
  const id = `${tier}|${scale}`;
  if (urlCache.has(id)) return urlCache.get(id);
  const [g, p] = TIER_ICON[tier] || TIER_ICON.plankton;
  const url = sprite(g, p, scale).toDataURL();
  urlCache.set(id, url);
  return url;
}
