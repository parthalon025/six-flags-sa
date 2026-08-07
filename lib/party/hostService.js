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
  SET_TARGET,
  SNAPSHOT,
  WELCOME,
  addressedTo,
} from '../core/protocol.js';
import { createParty, evict, publicSnapshot, reduce } from '../core/state.js';
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
  [SET_MEET]: 'set-meet',
  [BYE]: 'leave',
};

export function createHostService({
  session,
  key,
  transport,
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

  // The host is a member like anybody else — it appears on its own roster, and
  // going through `reduce` means it gets the same record shape as a joiner.
  state = reduce(
    state,
    { kind: 'join', from: selfId, body: { name: session?.memberName || 'Host', avatar: null } },
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

  function broadcastPatch(result) {
    // `silent` (and an empty op list) is the reducer saying nothing worth a
    // radio wakeup happened. An idle party must produce no traffic but PING.
    if (result.silent || !result.ops?.length) return;
    post(PATCH, EVERYONE, { version: result.state.version, ops: result.ops });
  }

  function commit(result) {
    if (!result) return;
    const changed = result.state !== state;
    state = result.state;
    broadcastPatch(result);
    if (changed) emitter.emit('change', state);
  }

  /* -------------------------------------------------------------- inbound -- */

  /**
   * A joining peer sends its whole member record (`{ member }`); the reducer
   * reads a flat `{ name, avatar }`. Accept either shape rather than trusting a
   * peer to have got it right.
   */
  function joinBody(body) {
    const m = body?.member && typeof body.member === 'object' ? body.member : body || {};
    return { name: typeof m.name === 'string' ? m.name : undefined, avatar: m.avatar ?? null };
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
        counters.dropped += 1;
        return undefined;
      }
      counters.received += 1;

      if (f.kind === HELLO) return acceptJoin(f);
      if (f.kind === RESYNC) return answerResync(f);
      if (ELECTION_KINDS.has(f.kind)) {
        // A live host being campaigned against means the party thinks it is
        // gone. Nothing to decide here; the app layer owns stepping down.
        emitter.emit('election', f);
        return undefined;
      }

      const command = COMMAND_FOR[f.kind];
      if (!command) {
        counters.dropped += 1; // a host kind from a peer: not ours to act on
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
    // WELCOME first: it carries the joiner's own arrival, so the PATCH that
    // follows is one they already hold and will ignore rather than treat as a
    // gap. The rest of the party needs the PATCH.
    post(WELCOME, f.from, { snapshot: publicSnapshot(state), youId: f.from });
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
      post(PING, EVERYONE, { version: state.version });
    }, PING_INTERVAL_MS);
    evictTimer = setIntervalFn(() => commit(evict(state, now())), EVICT_INTERVAL_MS);
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
    getState: () => state,
    handleSealed,
    applyLocal,
    on: emitter.on,
    stats,
  };
}
