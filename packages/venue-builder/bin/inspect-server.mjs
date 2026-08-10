#!/usr/bin/env node
/**
 * Standalone venue inspection server for visual review before publishing.
 * Serves a comparison dashboard and the built venue files for map preview.
 *
 *   npm run venues:inspect
 *   open http://127.0.0.1:3921
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareAll, summary } from '../src/compare.mjs';
import { APP_ROOT } from '../src/paths.mjs';

const PORT = Number(process.env.INSPECT_PORT || 3921);
const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../ui');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/api/compare') {
    const reports = compareAll();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary(reports)));
    return;
  }

  if (url.pathname.startsWith('/venues/')) {
    const rel = url.pathname.slice('/venues/'.length);
    const file = path.join(APP_ROOT, 'public', 'venues', rel);
    if (!file.startsWith(path.join(APP_ROOT, 'public', 'venues'))) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(readFileSync(file));
    return;
  }

  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.join(UI_DIR, file);
  if (!file.startsWith(UI_DIR) || !existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
  res.end(readFileSync(file));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Venue inspector: http://127.0.0.1:${PORT}`);
});
