#!/usr/bin/env node
/**
 * Standalone venue inspection server for visual review before publishing.
 * Serves a comparison dashboard and the built venue files for map preview.
 *
 *   npm run venues:inspect
 *   open http://127.0.0.1:3921
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROOT } from '../src/paths.mjs';
import { createInspectHandler } from '../lib/inspect-handlers.mjs';

const PORT = Number(process.env.INSPECT_PORT || 3921);
const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../ui');
const VENUES_DIR = path.join(APP_ROOT, 'public', 'venues');

const server = http.createServer(
  createInspectHandler({ uiDir: UI_DIR, venuesDir: VENUES_DIR }),
);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Venue inspector: http://127.0.0.1:${PORT}`);
});
