#!/usr/bin/env node
/**
 * Self-hosted party host.
 *
 * Zero dependencies — plain node:http. Runs anywhere that gives you a Node
 * process and a port: Render, Fly.io, Koyeb, a Raspberry Pi, a laptop behind a
 * Cloudflare Tunnel.
 *
 *   node server/index.mjs
 *   PORT=8080 DATA_FILE=./parties.json ORIGIN=https://park.example node server/index.mjs
 *
 * It serves three unrelated things on one port:
 *
 *   /api/mailbox/*  a dumb store-and-forward relay. Everything in `data` is
 *                   sealed ciphertext; this process cannot read it and never
 *                   tries. It routes on party id and peer id, nothing else.
 *   /api/party/* …  the REST host, for clients that would rather talk plain
 *                   HTTP than run the peer protocol. Every rule it applies
 *                   comes out of lib/core/state.js, so a party hosted here and
 *                   a party hosted on somebody's phone behave identically.
 *   /api/health …   operational surface: health, readiness, metrics, version.
 */

import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PROTOCOL_VERSION, EVERYONE } from '../lib/core/protocol.js';
import {
  createParty,
  createMember,
  reduce,
  applyOps,
  evict,
  publicSnapshot,
  OP,
  PARTY_TTL_MS,
} from '../lib/core/state.js';
import { newPartyCode, newMemberId, normalizeCode } from '../lib/core/ids.js';

/* ----------------------------------------------------------------- config */

const PORT = Number(process.env.PORT || 8787);
const DATA_FILE = process.env.DATA_FILE || '';
const ORIGINS = String(process.env.ORIGIN || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const MESSAGE_TTL_MS = 5 * 60 * 1000;
const MAILBOX_TTL_MS = 8 * 60 * 60 * 1000;
const QUEUE_CAP = 500;
const SWEEP_MS = 30 * 1000;
const HEARTBEAT_MS = 20 * 1000;
const BODY_LIMIT = 256 * 1024; // sealed frames are opaque, so leave real headroom
const SAVE_DEBOUNCE_MS = 1500;

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const pkg = readJson(here('../package.json')) || {};
const VERSION = pkg.version || '0.0.0';

/**
 * A venue's POI list has no ids — the app keys off the name. Slugs are stable
 * as long as the name is, and the name is what people say out loud, so both
 * work as a lookup key here.
 *
 * Every venue in public/venues is loaded, because this server has no idea which
 * one the phones talking to it are looking at; `?venue=<id>` picks, and the
 * manifest's default answers when nobody says.
 */
const MANIFEST = readJson(here('../public/venues/manifest.json')) || { venues: [] };
const CATALOGUES = new Map();
for (const v of MANIFEST.venues || []) {
  const pois = readJson(here(`../public/venues/${v.id}.pois.json`)) || [];
  const rides = pois.map((r) => ({ id: slug(r.n), ...r }));
  const byId = new Map();
  for (const r of rides) {
    byId.set(r.id, r);
    byId.set(r.n.toLowerCase(), r);
  }
  CATALOGUES.set(v.id, { rides, byId });
}
const DEFAULT_VENUE = MANIFEST.default || MANIFEST.venues?.[0]?.id || null;
const catalogueFor = (id) =>
  CATALOGUES.get(id) || CATALOGUES.get(DEFAULT_VENUE) || { rides: [], byId: new Map() };

/* ------------------------------------------------------------------ state */

/** partyId -> { state, emptySince } — `state` is exactly what lib/core/state.js owns. */
const parties = new Map();
/** partyId -> { createdAt, seq, messages: [], clients: Set<{ res, peerId }> } */
const mailboxes = new Map();

const metrics = {
  messagesIn: 0,
  messagesOut: 0,
  messagesDropped: 0,
  requests: 0,
  errors: 0,
};

let ready = false;
let shuttingDown = false;

/* ------------------------------------------------------------ persistence */

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function load() {
  if (!DATA_FILE) return;
  const raw = readJson(DATA_FILE);
  if (!raw) return;
  const now = Date.now();
  for (const row of raw.parties || []) {
    if (!row?.state?.id) continue;
    // A record written by an older build can be missing fields the reducer now
    // assumes exist, so every member is rebuilt on top of a fresh default.
    const ops = Object.entries(row.state.members || {}).map(([id, m]) => ({
      type: OP.MEMBER_SET,
      id,
      member: { ...createMember({ id, now: m?.lastSeen ?? now }), ...m },
    }));
    parties.set(row.state.id, {
      state: applyOps({ ...createParty({ id: row.state.id }), ...row.state }, ops),
      emptySince: row.emptySince ?? null,
    });
    // Sequence numbers must not go backwards across a restart, or a client
    // holding a cursor would silently skip everything below its high-water mark.
    if (row.seq) mailbox(row.state.id).seq = row.seq;
  }
  log(`restored ${parties.size} parties from ${DATA_FILE}`);
}

let saveTimer = null;
function save() {
  if (!DATA_FILE || shuttingDown) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, SAVE_DEBOUNCE_MS);
}

function flush() {
  if (!DATA_FILE) return;
  const rows = [...parties.entries()].map(([id, p]) => ({
    state: p.state,
    emptySince: p.emptySince,
    seq: mailboxes.get(id)?.seq || 0,
  }));
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ v: 1, parties: rows }), 'utf8');
  } catch (err) {
    log(`could not persist: ${err.message}`);
  }
}

/* ---------------------------------------------------------------- mailbox */

function mailbox(partyId) {
  let box = mailboxes.get(partyId);
  if (!box) {
    box = { createdAt: Date.now(), seq: 0, messages: [], clients: new Set() };
    mailboxes.set(partyId, box);
  }
  return box;
}

function deliverable(msg, peerId) {
  // A peer never receives its own broadcast back; without this every sender
  // would have to filter its own echo out of a fan-out.
  return msg.from !== peerId && (msg.to === EVERYONE || msg.to === peerId);
}

function publish(partyId, msg) {
  const box = mailbox(partyId);
  box.seq += 1;
  const stored = { seq: box.seq, ts: Date.now(), ...msg };
  box.messages.push(stored);
  if (box.messages.length > QUEUE_CAP) {
    metrics.messagesDropped += box.messages.length - QUEUE_CAP;
    box.messages.splice(0, box.messages.length - QUEUE_CAP);
  }
  metrics.messagesIn += 1;

  const line = `data: ${JSON.stringify(wire(stored))}\n\n`;
  for (const client of box.clients) {
    if (!deliverable(stored, client.peerId)) continue;
    try {
      client.res.write(line);
      metrics.messagesOut += 1;
    } catch {
      box.clients.delete(client);
    }
  }
  return stored.seq;
}

const wire = (m) => ({ seq: m.seq, from: m.from, to: m.to, kind: m.kind, data: m.data });

function drain(partyId, peerId, since) {
  const box = mailboxes.get(partyId);
  if (!box) return { messages: [], cursor: since };
  const messages = box.messages
    .filter((m) => m.seq > since && deliverable(m, peerId))
    .map(wire);
  metrics.messagesOut += messages.length;
  // The cursor tracks the whole queue, not just what this peer could see —
  // otherwise a peer that is only ever addressed rarely rescans the backlog.
  return { messages, cursor: box.seq };
}

function closeClients(box) {
  for (const client of box.clients) {
    try {
      client.res.end();
    } catch {
      /* the socket is already gone */
    }
  }
  box.clients.clear();
}

/* ------------------------------------------------------------------ sweep */

function sweep() {
  const now = Date.now();

  for (const [id, box] of mailboxes) {
    const cut = now - MESSAGE_TTL_MS;
    const live = box.messages.filter((m) => m.ts > cut);
    metrics.messagesDropped += box.messages.length - live.length;
    box.messages = live;
    if (now - box.createdAt > MAILBOX_TTL_MS) {
      closeClients(box);
      mailboxes.delete(id);
    }
  }

  let changed = false;
  for (const [id, party] of parties) {
    const { state, ops } = evict(party.state, now);
    if (ops.length) {
      party.state = state;
      changed = true;
    }
    const empty = Object.keys(party.state.members).length === 0;
    if (empty && party.emptySince == null) party.emptySince = now;
    if (!empty) party.emptySince = null;
    if (party.emptySince != null && now - party.emptySince > PARTY_TTL_MS) {
      parties.delete(id);
      const box = mailboxes.get(id);
      if (box) {
        closeClients(box);
        mailboxes.delete(id);
      }
      changed = true;
    }
  }
  if (changed) save();
}

/* -------------------------------------------------------------- transport */

function corsFor(req) {
  const origin = req.headers.origin;
  const allow = ORIGINS.includes('*') ? '*' : ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    ...(allow === '*' ? {} : { Vary: 'Origin' }),
  };
}

function send(req, res, status, body, type = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  if (status >= 400) metrics.errors += 1;
  res.writeHead(status, {
    ...corsFor(req),
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

const json = (req, res, status, body) => send(req, res, status, body);
const fail = (req, res, status, error) => send(req, res, status, { ok: false, error });

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let over = false;
    req.on('data', (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        // Answer now rather than destroying the socket: the caller gets a real
        // status instead of a reset, and node drops the unread body for us.
        over = true;
        req.pause();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (over) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(text || '{}');
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
    req.on('aborted', () => resolve(null));
  });
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const routingKey = (v) => (/^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : '');

const log = (line) => console.log(`[party-host] ${line}`);

/* --------------------------------------------------------------- domain -- */

/**
 * Every party endpoint funnels through here: look the party up, hand one
 * command to the shared reducer, keep whatever it decides. No endpoint is
 * allowed its own opinion about the rules.
 */
function command(partyId, from, kind, body) {
  const party = parties.get(partyId);
  if (!party) return null;
  const { state, ops } = reduce(party.state, { kind, from, body }, Date.now());
  party.state = state;
  if (ops.length) {
    party.emptySince = Object.keys(state.members).length ? null : Date.now();
    save();
  }
  return { party, ops };
}

/* --------------------------------------------------------------- routing - */

async function route(req, res, url, parts) {
  const [, section, a, b] = parts; // parts[0] is always 'api' by the time we get here

  /* -- mailbox ---------------------------------------------------------- */

  if (section === 'mailbox' && a) {
    // Deliberately not normalised: to the relay a party id is an opaque routing
    // key, and rewriting it would silently split senders from receivers.
    const partyId = routingKey(a);
    if (!partyId) return fail(req, res, 400, 'bad party id');

    if (b === 'stream' && req.method === 'GET') return stream(req, res, url, partyId);

    if (!b && req.method === 'POST') {
      const body = await readBody(req);
      if (!body) return fail(req, res, 400, 'bad json');
      const from = str(body.from, 64);
      const to = str(body.to, 64);
      const kind = str(body.kind, 64);
      if (!from || !to || !kind) return fail(req, res, 400, 'from, to and kind are required');
      if (body.data === undefined) return fail(req, res, 400, 'data is required');
      // `data` is sealed ciphertext: it is stored and forwarded verbatim and
      // never inspected, so there is nothing here to validate beyond presence.
      const seq = publish(partyId, { from, to, kind, data: body.data });
      return json(req, res, 200, { ok: true, seq });
    }

    if (!b && req.method === 'GET') {
      const peerId = str(url.searchParams.get('for'), 64);
      if (!peerId) return fail(req, res, 400, 'for is required');
      const since = Number(url.searchParams.get('since') || 0);
      if (!Number.isFinite(since) || since < 0) return fail(req, res, 400, 'bad since');
      return json(req, res, 200, drain(partyId, peerId, since));
    }

    return fail(req, res, 405, 'method not allowed');
  }

  /* -- party lifecycle -------------------------------------------------- */

  if (section === 'party') {
    if (req.method === 'POST' && (a === 'create' || a === 'join' || a === 'leave')) {
      const body = await readBody(req);
      if (!body) return fail(req, res, 400, 'bad json');

      if (a === 'create') {
        const memberId = str(body.memberId, 64) || newMemberId();
        let id = newPartyCode();
        for (let i = 0; i < 8 && parties.has(id); i += 1) id = newPartyCode();
        if (parties.has(id)) return fail(req, res, 503, 'could not allocate a party id');
        parties.set(id, {
          state: createParty({
            id,
            name: str(body.name, 40) || 'Party',
            leader: memberId,
            transport: 'self-host',
          }),
          emptySince: Date.now(),
        });
        command(id, memberId, 'join', {
          name: str(body.memberName, 24),
          avatar: body.avatar ?? null,
        });
        save();
        return json(req, res, 200, {
          ok: true,
          partyId: id,
          you: memberId,
          party: publicSnapshot(parties.get(id).state),
        });
      }

      const partyId = normalizeCode(body.partyId);
      if (!parties.has(partyId)) return fail(req, res, 404, 'no such party');

      if (a === 'join') {
        const memberId = str(body.memberId, 64) || newMemberId();
        const out = command(partyId, memberId, 'join', {
          name: str(body.name, 24),
          avatar: body.avatar ?? null,
        });
        return json(req, res, 200, {
          ok: true,
          partyId,
          you: memberId,
          party: publicSnapshot(out.party.state),
        });
      }

      const memberId = str(body.memberId, 64);
      if (!memberId) return fail(req, res, 400, 'memberId is required');
      const out = command(partyId, memberId, 'leave', {});
      return json(req, res, 200, { ok: true, left: out.ops.length > 0, version: out.party.state.version });
    }

    if (req.method === 'DELETE' && a) {
      const partyId = normalizeCode(a);
      const existed = parties.delete(partyId);
      const box = mailboxes.get(partyId);
      if (box) {
        closeClients(box);
        mailboxes.delete(partyId);
      }
      save();
      return existed
        ? json(req, res, 200, { ok: true, deleted: partyId })
        : fail(req, res, 404, 'no such party');
    }

    return fail(req, res, 405, 'method not allowed');
  }

  /* -- roster and member updates ---------------------------------------- */

  if (section === 'members' && a && req.method === 'GET') {
    const party = parties.get(normalizeCode(a));
    if (!party) return fail(req, res, 404, 'no such party');
    const snap = publicSnapshot(party.state);
    return json(req, res, 200, {
      ok: true,
      version: snap.version,
      leader: snap.leader,
      members: Object.values(snap.members),
    });
  }

  if ((section === 'location' || section === 'heartbeat' || section === 'member') && a) {
    const wantMethod = section === 'member' ? 'PATCH' : 'POST';
    if (req.method !== wantMethod) return fail(req, res, 405, 'method not allowed');
    const partyId = normalizeCode(a);
    if (!parties.has(partyId)) return fail(req, res, 404, 'no such party');
    const body = await readBody(req);
    if (!body) return fail(req, res, 400, 'bad json');
    const memberId = str(body.memberId, 64);
    if (!memberId) return fail(req, res, 400, 'memberId is required');

    if (section === 'location') {
      const loc = body.location;
      if (!loc || typeof loc !== 'object') return fail(req, res, 400, 'location is required');
      if (!Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lng))) {
        return fail(req, res, 400, 'location needs a numeric lat and lng');
      }
      const at = {
        lat: Number(loc.lat),
        lng: Number(loc.lng),
        acc: Number.isFinite(Number(loc.acc)) ? Number(loc.acc) : null,
        heading: Number.isFinite(Number(loc.heading)) ? Number(loc.heading) : null,
        speed: Number.isFinite(Number(loc.speed)) ? Number(loc.speed) : null,
        ts: Number.isFinite(Number(loc.ts)) ? Number(loc.ts) : Date.now(),
      };
      const out = command(partyId, memberId, 'location', { location: at });
      // The reducer drops a fix that is invalid or older than the one it holds;
      // either way the caller gets told whether anything moved.
      return json(req, res, 200, { ok: true, applied: out.ops.length > 0, version: out.party.state.version });
    }

    if (section === 'heartbeat') {
      const beat = {};
      if (body.battery !== undefined) beat.battery = body.battery;
      if (body.status !== undefined) beat.status = str(body.status, 24);
      const out = command(partyId, memberId, 'heartbeat', beat);
      if (!out.party.state.members[memberId]) return fail(req, res, 404, 'not a member');
      return json(req, res, 200, { ok: true, version: out.party.state.version, serverTime: Date.now() });
    }

    const patch = body.patch && typeof body.patch === 'object' ? body.patch : body;
    const out = command(partyId, memberId, 'patch-member', { patch });
    if (!out.party.state.members[memberId]) return fail(req, res, 404, 'not a member');
    return json(req, res, 200, {
      ok: true,
      applied: out.ops.length > 0,
      member: out.party.state.members[memberId],
    });
  }

  if (section === 'favorites' && a && req.method === 'PATCH') {
    const partyId = normalizeCode(a);
    if (!parties.has(partyId)) return fail(req, res, 404, 'no such party');
    const body = await readBody(req);
    if (!body) return fail(req, res, 400, 'bad json');
    const memberId = str(body.memberId, 64);
    const rideId = str(body.rideId, 80);
    if (!memberId || !rideId) return fail(req, res, 400, 'memberId and rideId are required');
    const out = command(partyId, memberId, 'set-favorite', {
      rideId,
      favorite: Boolean(body.favorite),
    });
    const me = out.party.state.members[memberId];
    if (!me) return fail(req, res, 404, 'not a member');
    return json(req, res, 200, { ok: true, favorites: me.favorites, version: out.party.state.version });
  }

  /* -- rides ------------------------------------------------------------- */

  if (section === 'rides' && req.method === 'GET') {
    const asked = url.searchParams.get('venue');
    const venue = CATALOGUES.has(asked) ? asked : DEFAULT_VENUE;
    const { rides, byId } = catalogueFor(venue);
    if (!a) return json(req, res, 200, { ok: true, venue, count: rides.length, rides });
    const ride = byId.get(decodeURIComponent(a).toLowerCase());
    return ride ? json(req, res, 200, { ok: true, venue, ride }) : fail(req, res, 404, 'no such ride');
  }

  /* -- operational ------------------------------------------------------- */

  if (req.method === 'GET') {
    if (section === 'health') {
      return json(req, res, 200, { ok: true, uptime: Math.round(process.uptime()), version: VERSION });
    }
    if (section === 'ready') {
      return ready && !shuttingDown
        ? json(req, res, 200, { ok: true })
        : json(req, res, 503, { ok: false, error: 'not ready' });
    }
    if (section === 'version') {
      return json(req, res, 200, { version: VERSION, protocol: PROTOCOL_VERSION });
    }
    if (section === 'metrics') return send(req, res, 200, prometheus(), 'text/plain; version=0.0.4');
  }

  return fail(req, res, 404, 'not found');
}

/* ------------------------------------------------------------------- sse - */

function stream(req, res, url, partyId) {
  const peerId = str(url.searchParams.get('for'), 64);
  if (!peerId) return fail(req, res, 400, 'for is required');

  res.writeHead(200, {
    ...corsFor(req),
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx and friends buffer text/* by default, which turns SSE into polling.
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 4000\n\n');

  const box = mailbox(partyId);
  const client = { res, peerId };
  box.clients.add(client);

  const beat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* the close handler will clean up */
    }
  }, HEARTBEAT_MS);

  const bye = () => {
    clearInterval(beat);
    box.clients.delete(client);
  };
  req.on('close', bye);
  req.on('error', bye);
  return undefined;
}

/* --------------------------------------------------------------- metrics - */

function prometheus() {
  let members = 0;
  for (const p of parties.values()) members += Object.keys(p.state.members).length;
  let clients = 0;
  let queued = 0;
  for (const box of mailboxes.values()) {
    clients += box.clients.size;
    queued += box.messages.length;
  }
  const lines = [
    ['party_parties', 'gauge', 'parties currently hosted', parties.size],
    ['party_members', 'gauge', 'members across all parties', members],
    ['party_mailboxes', 'gauge', 'mailboxes currently held', mailboxes.size],
    ['party_mailbox_queued', 'gauge', 'messages waiting in mailboxes', queued],
    ['party_sse_clients', 'gauge', 'open sse streams', clients],
    ['party_messages_in_total', 'counter', 'messages accepted', metrics.messagesIn],
    ['party_messages_out_total', 'counter', 'messages handed to peers', metrics.messagesOut],
    ['party_messages_dropped_total', 'counter', 'messages expired or capped', metrics.messagesDropped],
    ['party_requests_total', 'counter', 'http requests served', metrics.requests],
    ['party_errors_total', 'counter', 'requests answered 4xx or 5xx', metrics.errors],
    ['party_uptime_seconds', 'gauge', 'process uptime', Math.round(process.uptime())],
  ];
  return `${lines
    .map(([name, type, help, value]) => `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}`)
    .join('\n')}\n`;
}

/* ---------------------------------------------------------------- server - */

const server = http.createServer((req, res) => {
  metrics.requests += 1;
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return fail(req, res, 400, 'bad request');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsFor(req));
    return res.end();
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return fail(req, res, 404, 'not found');

  // A throw anywhere downstream must cost one request, not the process.
  return route(req, res, url, parts).catch((err) => {
    log(`unhandled: ${err?.stack || err}`);
    if (!res.headersSent) fail(req, res, 500, 'internal error');
    else res.end();
  });
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

load();
const sweeper = setInterval(sweep, SWEEP_MS);
sweeper.unref?.();

server.listen(PORT, () => {
  ready = true;
  const features = [
    'mailbox',
    'rest',
    'sse',
    DATA_FILE ? `persist=${DATA_FILE}` : 'persist=off',
    `origin=${ORIGINS.join(',')}`,
    `venues=${CATALOGUES.size}`,
    `protocol=v${PROTOCOL_VERSION}`,
  ];
  log(`v${VERSION} listening on :${PORT} — ${features.join(' ')}`);
});

/* -------------------------------------------------------------- shutdown - */

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  log(`${signal}: draining`);
  clearInterval(sweeper);
  if (saveTimer) clearTimeout(saveTimer);
  server.close(() => {
    flush();
    process.exit(0);
  });
  for (const box of mailboxes.values()) closeClients(box);
  // Nothing here is worth holding a container hostage over.
  setTimeout(() => {
    flush();
    process.exit(0);
  }, 3000).unref?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
