// Local dev server: serves the game and runs the /api functions the same way
// Vercel does. Usage:  npm run dev   →  http://localhost:3000
// Reads a .env file in this folder if you have one (see .env.example).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// tiny .env loader
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const apiCache = new Map();
async function apiHandler(name) {
  if (!apiCache.has(name)) {
    const file = path.join(root, 'api', `${name}.js`);
    if (!fs.existsSync(file)) return null;
    apiCache.set(name, (await import(pathToFileURL(file).href)).default);
  }
  return apiCache.get(name);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
    const handler = name && !name.startsWith('_') ? await apiHandler(name) : null;
    if (!handler) { res.statusCode = 404; return res.end('{"error":"not found"}'); }
    try { return await handler(req, res); } catch (e) {
      console.error(e); res.statusCode = 500; return res.end('{"error":"server error"}');
    }
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root) || file.includes(`${path.sep}api${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404; return res.end('Not found');
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Krillion Unlimited running at http://localhost:${port}`));
