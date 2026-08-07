#!/usr/bin/env node
/**
 * Kings Island party sync server.
 *
 * Zero dependencies — plain node:http. Runs on any free tier that gives you a
 * Node process and a port: Render, Fly.io, Koyeb, Railway, Glitch, or a laptop
 * behind a Cloudflare Tunnel.
 *
 *   node server/index.mjs
 *   PORT=8080 DATA_FILE=./parties.json node server/index.mjs
 *
 * Wire protocol is identical to the Next.js /api/party routes, so the client
 * can point at either one.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), '.party-data.json');
const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const PARTY_TTL_MS = 8 * 60 * 60 * 1000;
const MEMBER_TTL_MS = 45 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* ------------------------------------------------------------------ state */

/** code -> { code, created, members: {id: rec}, meet } */
const parties = new Map();
/** code -> Set<ServerResponse> */
const listeners = new Map();

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const p of raw.parties || []) parties.set(p.code, p);
    console.log(`[ki-sync] restored ${parties.size} parties from ${DATA_FILE}`);
  } catch {
    /* first run */
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({ parties: [...parties.values()] }),
        'utf8',
      );
    } catch (err) {
      console.warn('[ki-sync] could not persist:', err.message);
    }
  }, 1500);
}

function sweep() {
  const now = Date.now();
  for (const [code, party] of parties) {
    if (now - party.created > PARTY_TTL_MS) {
      parties.delete(code);
      closeListeners(code);
      continue;
    }
    let changed = false;
    for (const [id, m] of Object.entries(party.members)) {
      if (now - m.ts > MEMBER_TTL_MS) {
        delete party.members[id];
        changed = true;
      }
    }
    if (changed) broadcast(code);
  }
  save();
}

/* ------------------------------------------------------------- broadcast */

function snapshot(party) {
  return {
    code: party.code,
    members: Object.values(party.members),
    meet: party.meet,
    serverTime: Date.now(),
  };
}

function broadcast(code) {
  const party = parties.get(code);
  const set = listeners.get(code);
  if (!party || !set) return;
  const payload = `data: ${JSON.stringify(snapshot(party))}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}

function closeListeners(code) {
  const set = listeners.get(code);
  if (!set) return;
  for (const res of set) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  listeners.delete(code);
}

/* ------------------------------------------------------------- utilities */

const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...cors,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req, limit = 8192) {
  return new Promise((resolve) => {
    let data = '';
    let over = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        over = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (over) return resolve(null);
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const clean = (v, max) => String(v ?? '').slice(0, max);
const normalise = (v) =>
  String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

function makeCode() {
  let out = '';
  for (let i = 0; i < 5; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

// Crude per-IP token bucket. Enough to stop a loop hammering a free dyno.
const buckets = new Map();
function allowed(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { tokens: 60, ts: now };
  b.tokens = Math.min(60, b.tokens + ((now - b.ts) / 1000) * 2);
  b.ts = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}

/* ---------------------------------------------------------------- router */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (url.pathname === '/healthz') {
    return json(res, 200, {
      ok: true,
      parties: parties.size,
      listeners: [...listeners.values()].reduce((n, s) => n + s.size, 0),
      uptime: Math.round(process.uptime()),
    });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (!allowed(ip)) return json(res, 429, { error: 'Slow down' });

  // /api/party
  if (parts[0] === 'api' && parts[1] === 'party') {
    // POST /api/party  -> create
    if (parts.length === 2 && req.method === 'POST') {
      let code = makeCode();
      let guard = 0;
      while (parties.has(code) && guard < 10) {
        code = makeCode();
        guard += 1;
      }
      parties.set(code, { code, created: Date.now(), members: {}, meet: null });
      save();
      return json(res, 200, { code, durable: true });
    }

    const code = normalise(parts[2]);
    const party = parties.get(code);

    // GET /api/party/:code/stream  -> SSE
    if (parts.length === 4 && parts[3] === 'stream' && req.method === 'GET') {
      if (!party) return json(res, 404, { error: 'No such party' });
      res.writeHead(200, {
        ...cors,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 4000\n\n`);
      res.write(`data: ${JSON.stringify(snapshot(party))}\n\n`);
      if (!listeners.has(code)) listeners.set(code, new Set());
      listeners.get(code).add(res);
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* ignore */
        }
      }, 20000);
      req.on('close', () => {
        clearInterval(ping);
        listeners.get(code)?.delete(res);
      });
      return undefined;
    }

    // /api/party/:code/meet
    if (parts.length === 4 && parts[3] === 'meet') {
      if (!party) return json(res, 404, { error: 'No such party' });
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const lat = Number(body?.lat);
        const lng = Number(body?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return json(res, 400, { error: 'Missing position' });
        }
        party.meet = {
          lat,
          lng,
          label: clean(body.label || 'Meet-up', 40),
          by: clean(body.by || 'Someone', 16),
          ts: Date.now(),
        };
        save();
        broadcast(code);
        return json(res, 200, { meet: party.meet });
      }
      if (req.method === 'DELETE') {
        party.meet = null;
        save();
        broadcast(code);
        return json(res, 200, { ok: true });
      }
    }

    // /api/party/:code
    if (parts.length === 3) {
      if (!party) return json(res, 404, { error: 'No such party' });

      if (req.method === 'GET') return json(res, 200, snapshot(party));

      if (req.method === 'PUT') {
        const body = await readBody(req);
        if (!body?.id) return json(res, 400, { error: 'Missing id' });
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return json(res, 400, { error: 'Missing position' });
        }
        const id = clean(body.id, 40);
        party.members[id] = {
          id,
          name: clean(body.name || 'Guest', 16),
          lat,
          lng,
          acc: Number.isFinite(Number(body.acc)) ? Number(body.acc) : null,
          status: clean(body.status || 'On the move', 24),
          height: Number.isFinite(Number(body.height)) ? Number(body.height) : null,
          ts: Date.now(),
        };
        save();
        broadcast(code);
        return json(res, 200, snapshot(party));
      }

      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (id) delete party.members[id];
        save();
        broadcast(code);
        return json(res, 200, { ok: true });
      }
    }
  }

  return json(res, 404, { error: 'Not found' });
});

load();
setInterval(sweep, 60000).unref?.();

server.listen(PORT, () => {
  console.log(`[ki-sync] listening on :${PORT}  (origin ${ORIGIN})`);
});

const shutdown = () => {
  console.log('[ki-sync] shutting down');
  for (const code of listeners.keys()) closeListeners(code);
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ parties: [...parties.values()] }), 'utf8');
  } catch {
    /* ignore */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
