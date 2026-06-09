// Local server for Amedia Norgeskart.
//
// Serves the static files AND proxies the video "reels" endpoint on the SAME
// origin, at /api/reels. The upstream sends no CORS headers, so a direct browser
// call is blocked — routing it through here (same host:port as the page)
// sidesteps the browser's same-origin policy entirely.
//
// Run:   node serve.mjs           (http://localhost:8773)
//        node serve.mjs 3000      (custom port)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2]) || 8773;
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const REELS_UPSTREAM = 'https://services.api.no/api/video-yoshi/v1/reels';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 1. Reels proxy — a publication's own reel feed by sitekey. Same origin as
  //    the page, so no CORS. (Media URLs in the response are played directly by
  //    the <video> element and don't need proxying.)
  if (url.pathname === '/api/reels') {
    const publication = url.searchParams.get('publication') ?? '';
    const content = url.searchParams.get('content') ?? 'none';
    const tail = url.searchParams.get('tail') ?? 'latest';
    const target = `${REELS_UPSTREAM}?content=${encodeURIComponent(content)}&tail=${encodeURIComponent(tail)}&publication=${encodeURIComponent(publication)}`;
    try {
      const upstream = await fetch(target);
      const body = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // 2. Static files (with guards against path traversal and dotfiles).
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  // Never serve dotfiles/dirs (.git, .env, .DS_Store, …), even if inside ROOT.
  if (pathname.split('/').some((seg) => seg.startsWith('.'))) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const filePath = join(ROOT, normalize(pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Bind to loopback only — this is a local dev server, not for exposing on a LAN.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Amedia Norgeskart on http://localhost:${PORT}  (reels proxied at /api/reels)`);
});
