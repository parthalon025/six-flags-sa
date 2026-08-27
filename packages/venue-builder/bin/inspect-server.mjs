#!/usr/bin/env node
/**
 * Standalone venue inspection server for visual review before publishing.
 * Serves a comparison dashboard and the built venue files for map preview.
 *
 *   npm run venues:inspect
 *   open http://127.0.0.1:3921
 */
import { createInspectServer } from '../lib/inspect-server.mjs';

const PORT = Number(process.env.INSPECT_PORT || 3921);
const server = createInspectServer();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Venue inspector: http://127.0.0.1:${PORT}`);
});
