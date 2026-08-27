/**
 * Inspect server routes — comparison dashboard API and review persistence (#422).
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareAll, summary } from '../src/compare.mjs';
import { APP_ROOT } from '../src/paths.mjs';
import { recordReview, REVIEW_FILE } from './venue-review.mjs';
import { readJson, listVenuePackages } from './venue-io.mjs';

const BUILDER_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const INSPECT_UI_DIR = path.join(BUILDER_ROOT, '..', 'ui');

export const SHIP_REVIEW_KEY = 'ship';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(new Error(`invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

/** Latest ship decision per venue id from on-disk review sidecars. */
export function readShipReviewStates(venueIds = null) {
  const fromCompare = compareAll().map(({ stats }) => stats.id);
  const ids = venueIds ?? [...new Set([...fromCompare, ...listVenuePackages()])];
  const out = {};
  for (const venueId of ids) {
    const doc = readJson(REVIEW_FILE(venueId), { decisions: [] });
    const ship = [...doc.decisions].reverse().find((d) => d.key === SHIP_REVIEW_KEY);
    out[venueId] = ship?.decision ?? null;
  }
  return out;
}

export function createInspectHandler({ uiDir = INSPECT_UI_DIR } = {}) {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/api/compare' && req.method === 'GET') {
      const reports = compareAll();
      sendJson(res, 200, summary(reports));
      return;
    }

    if (url.pathname === '/api/reviews' && req.method === 'GET') {
      sendJson(res, 200, readShipReviewStates());
      return;
    }

    if (url.pathname === '/api/review' && req.method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      const venueId = body?.venueId;
      const decision = body?.decision;
      if (!venueId || typeof venueId !== 'string') {
        sendJson(res, 400, { error: 'venueId is required' });
        return;
      }
      try {
        const doc = recordReview(venueId, {
          key: SHIP_REVIEW_KEY,
          decision,
          who: body?.who || 'inspect-ui',
          why: body?.why || '',
          claimType: 'ship',
        });
        const latest = doc.decisions[doc.decisions.length - 1];
        sendJson(res, 200, {
          venueId,
          key: SHIP_REVIEW_KEY,
          decision: latest.decision,
          at: latest.at,
        });
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
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
    file = path.join(uiDir, file);
    if (!file.startsWith(uiDir) || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(readFileSync(file));
  };
}

export function createInspectServer(opts = {}) {
  const handler = createInspectHandler(opts);
  return http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    });
  });
}
