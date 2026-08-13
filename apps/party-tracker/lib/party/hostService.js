/**
 * The Party Service: the single authoritative copy of party state.
 *
 * The same object runs in the host phone's tab and in the Node host, so nothing
 * in here touches `window`, `document` or `navigator`, and every timer arrives
 * through options — a test drives it with fake clocks and no browser at all.
 *
 * Its whole job is a loop: decrypt what arrives, run it through `reduce`, and
 * broadcast the ops that came out. Clients never decide anything; they ask, and
 * this file answers with a patch.
 */

import {
  BYE,
  createDedupe,
  ELECTION_KINDS,
  EVERYONE,
  frame,
  HEARTBEAT,
  HELLO,
  isValidFrame,
  LOCATION,
  PATCH,
  PATCH_MEMBER,
  PING,
  RESYNC,
  SET_FAVORITE,
  SET_MEET,
  SET_PLAN,
  ADD_MEMBER,
  SET_RIDE_STATUS,
  SET_TARGET,
  SNAPSHOT,
  VICTORY,
  WELCOME,
  addressedTo,
} from '../core/protocol.js';
import { adoptSnapshot, createParty, evict, evictRides, publicSnapshot, reduce } from '../core/state.js';
import { betterHost } from './election.js';
import { open, seal } from '../core/crypto.js';
import { createEmitter } from '../transport/types.js';

/**
 * Fast enough that a client notices a dead host inside the election's 12 s
 * timeout with three beacons to spare, slow enough to be invisible on a battery
 * budget: an empty sealed PING is a couple of hundred bytes.
 */
const PING_INTERVAL_MS = 4000;
const EVICT_INTERVAL_MS = 60 * 1000;

/** Inbound protocol kind -> the command name `reduce` understands. */
const COMMAND_FOR = {
  [HELLO]: 'join',
  [LOCATION]: 'location',
  [HEARTBEAT]: 'heartbeat',
  [PATCH_MEMBER]: 'patch-member',
  [SET_FAVORITE]: 'set-favorite',
  [SET_TARGET]: 'set-target',
  [SET_RIDE_STATUS]: 'set-ride-status',
  [SET_MEET]: 'set-meet',
  [SET_PLAN]: 'set-plan',
  [ADD_MEMBER]: 'add-member',
  [REMOVE_MEMBER]: 'remove-member',
  [BYE]: 'leave',
};

export function createHostService({
  session,
  key,
  transport,
  // The winning claim, when this service exists because an election said so.
  // Null for the phone that started the party: it is the host by construction
  // and has never had to prove it against anybody.
  rank = null,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  const selfId = session?.selfId || 'host';
  const partyId = session?.partyId || '';
  const emitter = createEmitter();
  const dedupe = createDedupe();
  const counters = { sent: 0, received: 0, applied: 0, dropped: 0, errors: 0, lastError: null };

  let seq = 0;
  let running = false;
  let pingTimer = null;
  let evictTimer = null;
  /** Device-holding Member this host has asked to take over, or null. */
  let yieldedTo = null;
  // Outbound frames are serialised: `seal` is async, and two overlapping seals
  // can hand the transport a lower seq after a higher one, which the receiver's
  // dedupe would then discard as a replay.
  let outbound = Promise.resolve();

  let state = createParty({
    id: partyId,
    name: session?.partyName || 'Party',
    leader: selfId,
    now: now(),
    transport: activeName(),
  });

  // A promoted client hands over its last replica as `session.snapshot`, so a
  // migration keeps the roster, the meet-up and the version number instead of
  // restarting the party from zero underneath everybody.
  const resumed = session?.snapshot;
  if (
    resumed &&
    typeof resumed === 'object' &&
    resumed.members &&
    typeof resumed.members === 'object' &&
    Number.isFinite(resumed.version)
  ) {
    state = {
      ...adoptSnapshot(state, resumed),
      id: partyId,
      transport: activeName(),
      settings: { ...state.settings, ...(resumed.settings || {}) },
    };
    // Two version bumps the old members will never receive as patches; their
    // next PING shows them behind and they resync. Cheaper than a broadcast
    // storm at the exact moment the party is already repairing itself.
    state = reduce(state, { kind: 'set-leader', from: selfId, body: { leader: selfId } }, now()).state;
  }

  // The host is a member like anybody else — it appears on its own roster, and
  // going through `reduce` means it gets the same record shape as a joiner.
  state = reduce(
    state,
    { kind: 'join', from: selfId, body: { name: session?.memberName || 'Host', userId: session?.userId || null } },
    now(),
  ).state;

  /* ------------------------------------------------------------- outbound -- */

  function activeName() {
    try {
      return transport?.activeName?.() ?? null;
    } catch {
      return null;
    }
  }

  function fail(err) {
    counters.errors += 1;
    counters.lastError = String(err?.message || err);
    emitter.emit('error', { error: counters.lastError });
  }

  function post(kind, to, body) {
    let f;
    try {
      f = frame({ seq: (seq += 1), kind, from: selfId, to, body, ts: now() });
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

  /**
   * The rank this host is serving under, stamped onto everything that says "I
   * am hosting". Two phones that promoted in the same instant hear each other's
   * beacons and can then apply the election's own total order without having to
   * re-run an election, so the loser stands down inside one beacon.
   */
  const stamp = (body) =>
    rank ? { ...body, score: rank.score, joinOrder: rank.joinOrder } : body;

  /**
   * Announce this host to the party unprompted: an answer to a peer that is
   * campaigning against us, or to one that thinks it won. It carries the
   * snapshot, so a peer that yields to it is repaired by the same frame.
   */
  function assert() {
    post(VICTORY, EVERYONE, stamp({ snapshot: publicSnapshot(state) }));
  }

  function broadcastPatch(result) {
    // `silent` (and an empty op list) is the reducer saying nothing worth a
    // radio wakeup happened. An idle party must produce no traffic but PING.
    if (result.silent || !result.ops?.length) return;
    post(PATCH, EVERYONE, { version: result.state.version, ops: result.ops });
  }

  function maybeYield() {
    const to = betterHost(state.members, selfId);
    if (!to) {
      yieldedTo = null;
      return;
    }
    if (yieldedTo === to) return;
    yieldedTo = to;
    emitter.emit('yield', { to });
    post(PING, EVERYONE, stamp({ version: state.version, yieldTo: to }));
  }

  function commit(result) {
    if (!result) return;
    const changed = result.state !== state;
    state = result.state;
    broadcastPatch(result);
    if (changed) {
      emitter.emit('change', state);
      maybeYield();
    }
  }

  /* -------------------------------------------------------------- inbound -- */

  /**
   * A joining peer sends its whole member record (`{ member }`); the reducer
   * reads a flat `{ name }`. Accept either shape rather than trusting a peer to
   * have got it right. Everything else the peer sends is dropped here — the
   * reducer builds the record — so an older build still putting `avatar` on the
   * wire joins normally and simply never gets the field back.
   */
  function joinBody(body) {
    const m = body?.member && typeof body.member === 'object' ? body.member : body || {};
    return {
      name: typeof m.name === 'string' ? m.name : undefined,
      userId: typeof m.userId === 'string' ? m.userId.slice(0, 64) : m.userId || undefined,
      height: Number.isFinite(m.height) ? m.height : undefined,
      withAdult: m.withAdult === false ? false : undefined,
      battery: m.battery !== undefined ? m.battery : undefined,
    };
  }

  async function handleSealed(sealed) {
    try {
      const f = await open(key, sealed);
      // A frame that will not decrypt is not an error worth reporting: on a
      // shared relay it is just somebody else's party.
      if (!f || !isValidFrame(f)) {
        counters.dropped += 1;
        return undefined;
      }
      if (f.from === selfId) return undefined; // our own broadcast, looped back
      if (!addressedTo(f, selfId)) return undefined;
      if (!dedupe.accept(f.from, f.seq)) {
        // A refreshed tab is a new run of the same member: same id, seq back
        // near zero, which the dedupe reads as a replay. HELLO is the frame
        // that says so, and it is idempotent, so let it through and restart the
        // counter — otherwise a refresh locks somebody out of their own party.
        //
        // A peer that has promoted itself is the same story with worse
        // consequences: its host service numbers from zero, so every frame that
        // says "I am hosting" reads as a replay, and the one message that could
        // end a split brain is the one message guaranteed to be dropped.
        if (f.kind !== HELLO && f.kind !== VICTORY && f.kind !== PING) {
          counters.dropped += 1;
          return undefined;
        }
        dedupe.forget(f.from);
        dedupe.accept(f.from, f.seq);
      }
      counters.received += 1;

      if (f.kind === HELLO) return acceptJoin(f);
      if (f.kind === RESYNC) return answerResync(f);
      // Two shapes of the same news: a peer campaigning against us because it
      // thinks we are gone, or a peer beaconing because it promoted itself in
      // the same moment we did. A rival's PING used to be dropped as none of our
      // business, which is precisely how two promoted phones could beacon past
      // each other for the rest of the trip. Nothing is decided here; the app
      // layer owns ranking the two and standing one of them down.
      if (ELECTION_KINDS.has(f.kind) || f.kind === PING) {
        emitter.emit('election', f);
        return undefined;
      }

      const command = COMMAND_FOR[f.kind];
      if (!command) {
        counters.dropped += 1;
        return undefined;
      }

      const result = reduce(state, { kind: command, from: f.from, body: f.body }, now());
      counters.applied += 1;
      commit(result);
      // A departed member's next session restarts its seq at 0, which would
      // otherwise look like a replay for the length of the dedupe window.
      if (f.kind === BYE) dedupe.forget(f.from);
      return undefined;
    } catch (err) {
      // Nothing a peer can send may take the host down.
      fail(err);
      return undefined;
    }
  }

  function acceptJoin(f) {
    const result = reduce(state, { kind: 'join', from: f.from, body: joinBody(f.body) }, now());
    const changed = result.state !== state;
    state = result.state;
    // Stamp yieldTo on WELCOME before any PING. A yield PING that beats WELCOME
    // would promote a joiner that has not adopted the roster yet.
    const to = betterHost(state.members, selfId);
    yieldedTo = to || null;
    post(WELCOME, f.from, {
      snapshot: publicSnapshot(state),
      youId: f.from,
      ...(yieldedTo ? { yieldTo: yieldedTo } : {}),
    });
    broadcastPatch(result);
    if (changed) emitter.emit('change', state);
    return undefined;
  }

  function answerResync(f) {
    const have = Number(f.body?.haveVersion);
    // Already current: replying would cost a full snapshot to say nothing.
    if (Number.isFinite(have) && have >= state.version) return undefined;
    post(SNAPSHOT, f.from, { snapshot: publicSnapshot(state) });
    return undefined;
  }

  /* --------------------------------------------------------------- local --- */

  /**
   * The host's own UI submits through the same reducer as everybody else, so
   * there is exactly one code path that can change state. Accepts either a
   * protocol kind or a reducer command name.
   */
  function applyLocal(command) {
    try {
      if (!command || typeof command !== 'object') return state;
      const kind = COMMAND_FOR[command.kind] || command.kind;
      const from = command.from || selfId;
      const body = kind === 'join' ? joinBody(command.body) : command.body || {};
      commit(reduce(state, { kind, from, body }, now()));
      return state;
    } catch (err) {
      fail(err);
      return state;
    }
  }

  /* -------------------------------------------------------------- timers --- */

  function start() {
    if (running) return;
    running = true;
    try {
      const opening = transport?.connect?.();
      if (opening?.catch) opening.catch(fail);
    } catch (err) {
      fail(err);
    }
    pingTimer = setIntervalFn(() => {
      // Carries the version so a client that quietly missed a patch notices
      // without waiting for the next one.
      post(PING, EVERYONE, stamp({
        version: state.version,
        ...(yieldedTo ? { yieldTo: yieldedTo } : {}),
      }));
    }, PING_INTERVAL_MS);
    evictTimer = setIntervalFn(() => {
      // Two sweeps on one timer, committed separately: each bumps the version
      // by one and a patch carrying both would look like a skipped version to
      // every replica.
      commit(evict(state, now()));
      commit(evictRides(state, now()));
    }, EVICT_INTERVAL_MS);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (pingTimer != null) clearIntervalFn(pingTimer);
    if (evictTimer != null) clearIntervalFn(evictTimer);
    pingTimer = null;
    evictTimer = null;
    // The transport is the caller's: a promotion hands the same one straight to
    // another service, and closing it here would strand the new host.
  }

  function stats() {
    let transportStats = null;
    try {
      transportStats = transport?.stats?.() ?? null;
    } catch {
      transportStats = null;
    }
    return {
      role: 'host',
      selfId,
      partyId,
      running,
      seq,
      version: state.version,
      members: Object.keys(state.members).length,
      ...counters,
      transport: activeName(),
      transportStats,
    };
  }

  return {
    start,
    stop,
    assert,
    rank: () => rank,
    getState: () => state,
    handleSealed,
    applyLocal,
    on: emitter.on,
    stats,
  };
}
