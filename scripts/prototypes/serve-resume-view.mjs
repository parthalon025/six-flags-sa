#!/usr/bin/env node
/** PROTOTYPE runner — serves executive-resume-human-view.html on a free port. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), 'executive-resume-human-view.html');
const html = readFileSync(file);

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/?variant=A`;
  console.log(`PROTOTYPE resume human view → ${url}`);
  console.log('Variants: A One Thing · B SITREP · C Decision Strip · D Brief Map');
  console.log('Arrow keys or bottom bar to switch. Ctrl+C to stop.');
});
