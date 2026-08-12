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
import { adoptSnapshot, applyOps, createMember, createParty, publicSnapshot } from '../core/state.js';
import { open, seal } from '../core/crypto.js';
import { createEmitter } from '../transport/types.js';
import { createElection } from './election.js';

const HEARTBEAT_INTERVAL_MS = 20 * 1000;
/** A gap repairs with one snapshot; asking again before it lands just costs data. */
const RESYNC_THROTTLE_MS = 2000;

export function createClient({ session, key, transport, snapshot = null, now = () => Date.now() }) {
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
  // Whoever is currently sending host frames — which is not the same thing as
  // the snapshot's `leader` field. After a migration the replica still names the
  // dead host until the new one's snapshot lands, and commands addressed there
  // would go nowhere, including the RESYNC that fetches that very snapshot.
  let hostId = null;
  let lastResyncAt = 0;
  let heartbeatTimer = null;
  let battery = null;
  let outbound = Promise.resolve(); // serialised: see hostService.js

  // A shaped replica from the start so the UI never has to null-check. Until
  // `adopted` it is a placeholder, not a party — version 0 with nobody in it.
  let state = createParty({ id: partyId, name: session?.partyName || 'Party', leader: null, now: now() });

  // A phone that has just stood down from hosting hands over the roster it was
  // serving. It is a starting picture, not the truth — `adopted` stays false, so
  // the winner's WELCOME still overwrites it — but it means the party does not
  // blink to an empty list on the way back to being a member.
  if (snapshot && snapshot.members && typeof snapshot.members === 'object') {
    state = {
      ...adoptSnapshot(state, snapshot),
      id: partyId,
      settings: { ...state.settings, ...(snapshot.settings || {}) },
    };
  }

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
  const toHost = () => hostId || state.leader || EVERYONE;

  function submit(kind, body = {}) {
    if (!CLIENT_KINDS.has(kind)) return outbound;
    // Deliberately no optimistic mutation: the host is the only writer, and a
    // local guess that the host then rejects is a bug the UI cannot see coming.
    return post(kind, body, toHost());
  }

  /**
   * The visitor leaving, as opposed to the tab going away.
   *
   * Broadcast rather than addressed to `toHost()`: `hostId` is only ever as
   * fresh as the last host frame this replica saw, so a phone that has just
   * lived through a migration still names the host that vanished — and a BYE
   * addressed to a member who is gone is delivered to every peer and accepted
   * by none, leaving a ghost on every roster until the member TTL evicts it.
   * BYE is a host-only command, so the peers that are not hosting drop it.
   *
   * @returns the outbound chain, so a caller can wait for it to reach the wire.
   */
  function leave() {
    return post(BYE, {}, EVERYONE);
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

  function noteHost(id) {
    hostId = id;
    election.noteHostSeen(id);
  }

  /**
   * Record who is hosting now, in the replica as well as in `hostId`.
   *
   * The replica's `leader` is normally the host's business, but a migration is
   * the one case where this phone learns the answer before any host frame can
   * carry it: the election reaches the same winner everywhere, and the winner's
   * own VICTORY names it outright. Both are overwritten by the new host's first
   * patch, which agrees with them.
   */
  function noteLeader(id) {
    if (!id || state.leader === id) return;
    state = { ...state, leader: id };
    emitter.emit('change', state);
  }

  function adopt(snapshot, reason) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (!snapshot.members || typeof snapshot.members !== 'object') return false;
    if (!Number.isFinite(snapshot.version)) return false;
    state = {
      ...adoptSnapshot(state, snapshot),
      settings: { ...state.settings, ...(snapshot.settings || {}) },
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
        // A peer promoted to host restarts its seq, which the dedupe reads as a
        // replay and would leave this client permanently deaf to the new host.
        // These three kinds carry whole state, so re-applying one costs nothing
        // and re-syncing the counter costs less than missing the migration.
        if (f.kind !== VICTORY && f.kind !== SNAPSHOT && f.kind !== WELCOME) {
          counters.dropped += 1;
          return undefined;
        }
        dedupe.forget(f.from);
        dedupe.accept(f.from, f.seq);
      }
      counters.received += 1;

      switch (f.kind) {
        case WELCOME:
          noteHost(f.from);
          adopt(f.body?.snapshot, 'welcome');
          break;
        case SNAPSHOT:
          noteHost(f.from);
          adopt(f.body?.snapshot, 'snapshot');
          break;
        case PATCH:
          noteHost(f.from);
          applyPatch(f.body);
          break;
        case PING:
          noteHost(f.from);
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
          hostId = f.from;
          // The winner is about to start a host service with a fresh seq of its
          // own; anything it has sent as a peer is history.
          dedupe.forget(f.from);
          if (Number(f.body?.snapshot?.version) >= state.version) adopt(f.body.snapshot, 'victory');
          // That snapshot is the replica the winner was holding a moment ago, so
          // it still names the host that died. The sender is the host now, by
          // definition; waiting for its set-leader patch to say so leaves every
          // other phone naming a phone that is in a locker.
          noteLeader(f.from);
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
  const followLeader = ({ leader, self = false }) => {
    // Losing the election is knowing who won it. Say so now rather than waiting
    // for the winner to get its host service up and beacon — and address
    // commands there too, since the phone `state.leader` still names is gone.
    if (self || !leader) return;
    hostId = leader;
    noteLeader(leader);
  };
  election.on('front-runner', followLeader);
  election.on('elected', followLeader);
  election.onPromote((detail) => {
    // The app swaps in a host service from here; this client stops being the
    // replica and its state becomes the new authoritative copy.
    emitter.emit('promote', { ...detail, snapshot: publicSnapshot(state) });
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
      userId: session?.userId || null,
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
    leave,
    getState: () => state,
    handleSealed,
    submit,
    on: emitter.on,
    stats,
  };
}
