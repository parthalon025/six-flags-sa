'use client';

/**
 * The party client: a replica and a mailbox, nothing more.
 *
 * It never decides anything. Commands go to the host, patches come back, and
 * the only local state is a copy of what the host last said. That is what makes
 * host migration cheap — a client holds no truth it could lose.
 *
 * Browser-only, unlike hostService.js: this is the half that reads the phone's
 * battery and radio to work out how good a host it would make.
 */

import {
  BYE,
  CLAIM,
  CLIENT_KINDS,
  EVERYONE,
  HEARTBEAT,
  HELLO,
  PATCH,
  PING,
  RESYNC,
  SNAPSHOT,
  VICTORY,
  VOTE,
  WELCOME,
  ERROR as ERROR_KIND,
  addressedTo,
  createDedupe,
  frame,
  isValidFrame,
} from '../core/protocol.js';
import { applyOps, createMember, createParty, publicSnapshot } from '../core/state.js';
import { open, seal } from '../core/crypto.js';
import { createEmitter } from '../transport/types.js';
import { createElection } from './election.js';

const HEARTBEAT_INTERVAL_MS = 20 * 1000;
/** A gap repairs with one snapshot; asking again before it lands just costs data. */
const RESYNC_THROTTLE_MS = 2000;

export function createClient({ session, key, transport, now = () => Date.now() }) {
  const selfId = session?.selfId || '';
  const partyId = session?.partyId || '';
  const emitter = createEmitter();
  const dedupe = createDedupe();
  const counters = {
    sent: 0,
    received: 0,
    dropped: 0,
    patches: 0,
    gaps: 0,
    resyncs: 0,
    errors: 0,
    lastError: null,
  };

  let seq = 0;
  let running = false;
  let adopted = false; // true once a WELCOME or SNAPSHOT has landed
  let lastResyncAt = 0;
  let heartbeatTimer = null;
  let battery = null;
  let outbound = Promise.resolve(); // serialised: see hostService.js

  // A shaped replica from the start so the UI never has to null-check. Until
  // `adopted` it is a placeholder, not a party — version 0 with nobody in it.
  let state = createParty({ id: partyId, name: session?.partyName || 'Party', leader: null, now: now() });

  /* ------------------------------------------------------------- outbound -- */

  function fail(err) {
    counters.errors += 1;
    counters.lastError = String(err?.message || err);
    emitter.emit('error', { error: counters.lastError });
  }

  function post(kind, body, to) {
    let f;
    try {
      f = frame({ seq: (seq += 1), kind, from: selfId, to: to || EVERYONE, body, ts: now() });
    } catch (err) {
      fail(err);
      return outbound;
    }
    outbound = outbound
      .then(async () => {
        const sealed = await seal(key, partyId, f);
        await transport.send(sealed);
        counters.sent += 1;
      })
      .catch(fail);
    return outbound;
  }

  /** Commands go to the host by name when we know it; before that, to anyone listening. */
  const toHost = () => state.leader || EVERYONE;

  function submit(kind, body = {}) {
    if (!CLIENT_KINDS.has(kind)) return outbound;
    // Deliberately no optimistic mutation: the host is the only writer, and a
    // local guess that the host then rejects is a bug the UI cannot see coming.
    return post(kind, body, toHost());
  }

  function requestResync(reason) {
    const at = now();
    if (at - lastResyncAt < RESYNC_THROTTLE_MS) return;
    lastResyncAt = at;
    counters.resyncs += 1;
    emitter.emit('resync', { reason, haveVersion: adopted ? state.version : -1 });
    post(RESYNC, { haveVersion: adopted ? state.version : -1 }, toHost());
  }

  /* -------------------------------------------------------------- inbound -- */

  function adopt(snapshot, reason) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (!snapshot.members || typeof snapshot.members !== 'object') return false;
    if (!Number.isFinite(snapshot.version)) return false;
    state = {
      ...state,
      ...snapshot,
      members: { ...snapshot.members },
      rides: { ...(snapshot.rides || {}) },
      settings: { ...(snapshot.settings || {}) },
    };
    adopted = true;
    emitter.emit('change', state);
    emitter.emit('sync', { reason, version: state.version });
    return true;
  }

  function applyPatch(body) {
    const version = Number(body?.version);
    const ops = Array.isArray(body?.ops) ? body.ops : null;
    if (!ops || !Number.isFinite(version)) return;
    if (!adopted) {
      requestResync('not-adopted');
      return;
    }
    if (version <= state.version) return; // already applied; a duplicate route
    if (version !== state.version + 1) {
      // The reducer bumps by exactly one per patch, so a jump means a patch was
      // lost. Repair with a snapshot rather than applying ops out of order.
      counters.gaps += 1;
      requestResync('gap');
      return;
    }
    state = { ...applyOps(state, ops), version };
    counters.patches += 1;
    emitter.emit('change', state);
  }

  async function handleSealed(sealed) {
    try {
      const f = await open(key, sealed);
      if (!f || !isValidFrame(f)) {
        counters.dropped += 1;
        return undefined;
      }
      if (f.from === selfId) return undefined;
      if (!addressedTo(f, selfId)) return undefined;
      if (!dedupe.accept(f.from, f.seq)) {
        counters.dropped += 1;
        return undefined;
      }
      counters.received += 1;

      switch (f.kind) {
        case WELCOME:
          election.noteHostSeen(f.from);
          adopt(f.body?.snapshot, 'welcome');
          break;
        case SNAPSHOT:
          election.noteHostSeen(f.from);
          adopt(f.body?.snapshot, 'snapshot');
          break;
        case PATCH:
          election.noteHostSeen(f.from);
          applyPatch(f.body);
          break;
        case PING:
          election.noteHostSeen(f.from);
          // The beacon carries the host's version, so a patch that never
          // arrived is caught within one beacon instead of silently persisting.
          if (adopted && Number(f.body?.version) > state.version) requestResync('ping-ahead');
          break;
        case ERROR_KIND:
          emitter.emit('host-error', f.body || {});
          break;
        case CLAIM:
          election.handleClaim(f);
          break;
        case VOTE:
          election.handleVote(f);
          break;
        case VICTORY:
          // The new host ships its snapshot with the announcement, which is what
          // lets a migration finish without a round trip.
          if (Number(f.body?.snapshot?.version) >= state.version) adopt(f.body.snapshot, 'victory');
          election.handleVictory(f);
          break;
        default:
          counters.dropped += 1; // a client kind from a peer: not ours to act on
          break;
      }
      return undefined;
    } catch (err) {
      fail(err);
      return undefined;
    }
  }

  /* ------------------------------------------------------ device signals --- */

  const nav = () => (typeof navigator === 'undefined' ? null : navigator);

  async function readBattery() {
    const n = nav();
    // getBattery is gone from most browsers now; its absence is normal, not an
    // error, and simply means this phone competes on its other numbers.
    if (!n || typeof n.getBattery !== 'function') return null;
    try {
      const b = await n.getBattery();
      battery = { level: Number(b?.level ?? 0), charging: Boolean(b?.charging) };
    } catch {
      battery = null;
    }
    return battery;
  }

  function connectionQuality() {
    const n = nav();
    const conn = n?.connection || n?.mozConnection || n?.webkitConnection || null;
    if (!conn) return 0.5; // unknown: neither favour nor punish this phone
    const byType = { 'slow-2g': 0.1, '2g': 0.25, '3g': 0.6, '4g': 1 };
    if (typeof conn.effectiveType === 'string' && byType[conn.effectiveType] !== undefined) {
      return byType[conn.effectiveType];
    }
    if (Number.isFinite(conn.downlink)) return Math.min(1, conn.downlink / 10);
    return 0.5;
  }

  function devicePerformance() {
    const n = nav();
    const cores = Number.isFinite(n?.hardwareConcurrency) ? Math.min(1, n.hardwareConcurrency / 8) : 0.5;
    const memory = Number.isFinite(n?.deviceMemory) ? Math.min(1, n.deviceMemory / 8) : 0.5;
    return (cores + memory) / 2;
  }

  function getCandidate() {
    const n = nav();
    return {
      battery: battery ?? 0.5,
      signal: connectionQuality(),
      network: n && n.onLine === false ? 0 : 1,
      performance: devicePerformance(),
      joinOrder: state.members[selfId]?.joinOrder ?? Number.MAX_SAFE_INTEGER,
    };
  }

  /* ------------------------------------------------------------ election --- */

  const election = createElection({
    selfId,
    getCandidate,
    send: (kind, body) => post(kind, body, EVERYONE),
    getSnapshot: () => (adopted ? publicSnapshot(state) : null),
    now,
  });

  election.onHostLost((detail) => emitter.emit('host-lost', detail));
  election.onPromote((detail) => {
    // The app swaps in a host service from here; this client stops being the
    // replica and its state becomes the new authoritative copy.
    emitter.emit('promote', { ...detail, snapshot: adopted ? publicSnapshot(state) : null });
  });

  /* -------------------------------------------------------------- timers --- */

  function heartbeat() {
    readBattery()
      .then(() => {
        submit(HEARTBEAT, battery ? { battery } : {});
      })
      .catch(fail);
  }

  function start() {
    if (running) return;
    running = true;
    try {
      const opening = transport?.connect?.();
      if (opening?.catch) opening.catch(fail);
    } catch (err) {
      fail(err);
    }
    const member = createMember({
      id: selfId,
      name: session?.memberName || 'Guest',
      avatar: session?.avatar ?? null,
      now: now(),
    });
    post(HELLO, { member }, EVERYONE);
    readBattery().catch(() => null);
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    election.start();
  }

  function stop() {
    if (!running) return;
    running = false;
    if (heartbeatTimer != null) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    election.stop();
    // Best effort: leaving cleanly deletes the record instead of waiting out
    // the roster TTL. The transport belongs to the caller and stays open.
    post(BYE, {}, toHost());
  }

  function stats() {
    let transportStats = null;
    try {
      transportStats = transport?.stats?.() ?? null;
    } catch {
      transportStats = null;
    }
    return {
      role: 'client',
      selfId,
      partyId,
      running,
      adopted,
      seq,
      version: state.version,
      members: Object.keys(state.members).length,
      ...counters,
      election: election.stats(),
      transport: (() => {
        try {
          return transport?.activeName?.() ?? null;
        } catch {
          return null;
        }
      })(),
      transportStats,
    };
  }

  return {
    start,
    stop,
    getState: () => state,
    handleSealed,
    submit,
    on: emitter.on,
    stats,
  };
}
