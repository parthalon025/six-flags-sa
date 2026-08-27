/**
 * HTTP handlers for venues:inspect — compare dashboard, venue files, evidence review.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { compareAll, summary } from '../src/compare.mjs';
import { OVERRIDE_DIR } from './venue-io.mjs';
import {
  evidenceReviewStatus,
  readEvidenceReviewHtml,
  renderEvidenceMissingPage,
} from './inspect-evidence.mjs';
import {
  certificationDashboard,
  certificationDetail,
} from './inspect-certification.mjs';
import { MANIFEST_FILE } from '../src/paths.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * @param {{ uiDir: string, venuesDir: string, overrideDir?: string }} opts
 */
export function createInspectHandler(opts) {
  const overrideDir = opts.overrideDir || OVERRIDE_DIR;
  const manifestPath = opts.manifestPath || MANIFEST_FILE;

  return (req, res) => {
    const host = req.headers.host || '127.0.0.1';
    const url = new URL(req.url || '/', `http://${host}`);

    if (url.pathname === '/api/compare') {
      const reports = compareAll();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(summary(reports)));
      return;
    }

    if (url.pathname === '/api/certifications') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(certificationDashboard({ overrideDir, manifestPath })));
      return;
    }

    const certificationApi = url.pathname.match(/^\/api\/certification\/([^/]+)$/);
    if (certificationApi) {
      const venueId = decodeURIComponent(certificationApi[1]);
      const detail = certificationDetail(venueId, { overrideDir });
      if (!detail.available) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ venueId, available: false, error: 'certification.json missing' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(detail));
      return;
    }

    const evidenceApi = url.pathname.match(/^\/api\/evidence\/([^/]+)$/);
    if (evidenceApi) {
      const venueId = decodeURIComponent(evidenceApi[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(evidenceReviewStatus(venueId, { overrideDir })));
      return;
    }

    const evidencePage = url.pathname.match(/^\/evidence\/([^/]+)$/);
    if (evidencePage) {
      const venueId = decodeURIComponent(evidencePage[1]);
      const html = readEvidenceReviewHtml(venueId, { overrideDir });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html || renderEvidenceMissingPage(venueId));
      return;
    }

    if (url.pathname.startsWith('/venues/')) {
      const rel = url.pathname.slice('/venues/'.length);
      const file = path.join(opts.venuesDir, rel);
      const root = path.resolve(opts.venuesDir);
      if (!path.resolve(file).startsWith(root)) {
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
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(readFileSync(file));
      return;
    }

    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = path.join(opts.uiDir, file);
    const uiRoot = path.resolve(opts.uiDir);
    if (!path.resolve(file).startsWith(uiRoot) || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(readFileSync(file));
  };
}
