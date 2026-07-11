// Minimal static file server for verifying the *built* widget embeds like a host page
// would consume it (one <script> + one element, no bundler). Serves the viewer/ dir so
// /dist/dri-viewer.js, /dist/basis/*, /examples/*, and /public/fixtures/* are reachable.
// Not part of the shipped package — a test/dev harness only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 5174;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const path = join(ROOT, rel === '/' ? 'examples/embed.html' : rel);
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': MIME[extname(path)] ?? 'application/octet-stream',
      // Assets are served cross-origin-friendly for embedding tests.
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, () => console.log(`static server on http://localhost:${PORT}/`));
