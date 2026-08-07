/**
 * Leader election and host migration.
 *
 * When the host's phone dies, goes in a locker or walks out of range, the party
 * must keep working without anybody being told to press anything. Every peer
 * runs the same scoring function over the same claims and reaches the same
 * winner independently, so the result does not depend on votes arriving or on
 * any peer being trusted to count them.
 *
 * Pure logic plus a small controller; no DOM, so this runs in Node under test.
 */

import { CLAIM, EVERYONE, VICTORY } from '../core/protocol.js';
import { createEmitter } from '../transport/types.js';

/**
 * Weights. The spec's priority order is battery, then signal, then network,
 * then device performance, then join order, and each criterion must beat every
 * criterion below it outright — a phone on 90% never loses to a phone on 80%
 * however good its radio is.
 *
 * That holds because each input is clamped to 0..1 and quantised to 1% steps,
 * so the smallest possible difference in one tier is worth 100x its weight,
 * while everything below it can contribute at most ~1.001x the next weight
 * down. One battery step is 1e10; every lower tier combined maxes out near
 * 1.001e9, an order of magnitude less. Join order is the final tiebreak and
 * contributes at most 1.
 */
const W_BATTERY = 1e12;
const W_SIGNAL = 1e9;
const W_NETWORK = 1e6;
const W_PERFORMANCE = 1e3;
const W_JOIN_ORDER = 1;

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
/** 1% steps: finer than any of these signals is actually measured. */
const quantise = (n) => Math.round(clamp01(n) * 100) / 100;

function batteryLevel(battery) {
  if (typeof battery === 'number') return clamp01(battery);
  if (battery && typeof battery === 'object') {
    // A phone on a charger will outlast the trip whatever it reads right now,
    // so it scores as a full one and the decision falls to signal.
    return battery.charging ? 1 : clamp01(battery.level);
  }
  return 0;
}

/**
 * A single comparable number for one candidate. Higher is a better host.
 * Everything hostile or missing degrades to 0 rather than NaN, so a peer cannot
 * win by sending nonsense.
 */
export function scoreCandidate({ battery, signal, network, performance, joinOrder } = {}) {
  const order = Number.isFinite(joinOrder) && joinOrder >= 0 ? Math.floor(joinOrder) : 1e6;
  return (
    W_BATTERY * quantise(batteryLevel(battery)) +
    W_SIGNAL * quantise(typeof signal === 'number' ? signal : signal ? 1 : 0) +
    W_NETWORK * quantise(typeof network === 'number' ? network : network ? 1 : 0) +
    W_PERFORMANCE * quantise(typeof performance === 'number' ? performance : 0) +
    // Strictly decreasing in joinOrder and never more than one whole
    // W_PERFORMANCE step, so it can only ever break an exact tie.
    (W_JOIN_ORDER * 1) / (1 + order)
  );
}

/**
 * Total order over candidates. Score first, then the earlier joiner, then the
 * lexicographically lower id — which is arbitrary but identical on every phone,
 * and that is the property that stops two peers promoting themselves.
 */
function beats(a, b) {
  if (a.score !== b.score) return a.score > b.score;
  if (a.joinOrder !== b.joinOrder) return a.joinOrder < b.joinOrder;
  return a.id < b.id;
}

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

export function createElection({
  selfId,
  getCandidate,
  send,
  getSnapshot = () => null,
  onPromote = null,
  onHostLost: onHostLostOption = null,
  now = () => Date.now(),
  hostTimeoutMs = 12000,
  claimWindowMs = 2500,
  // Timers are injectable for the same reason the host service's are: tests
  // drive this with a fake clock. `tick()` alone is enough to run an election.
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  watchIntervalMs = 1000,
}) {
  const emitter = createEmitter();
  if (typeof onPromote === 'function') emitter.on('promote', onPromote);
  if (typeof onHostLostOption === 'function') emitter.on('host-lost', onHostLostOption);

  const claims = new Map();
  const votes = new Map();

  let running = false;
  let electing = false;
  let promoted = false;
  let leaderId = null;
  let lastHostSeen = now();
  let claimDeadline = 0;
  let lastVictorySentAt = 0;
  let myClaim = null;
  let watchTimer = null;
  let claimTimer = null;

  function safeSend(kind, body) {
    try {
      send?.(kind, body, EVERYONE);
    } catch {
      // A transport that cannot carry the claim will time out on its own; the
      // election must not die on the way out.
    }
  }

  function selfClaim() {
    let candidate = null;
    try {
      candidate = getCandidate?.() || null;
    } catch {
      candidate = null;
    }
    const joinOrder = num(candidate?.joinOrder, Number.MAX_SAFE_INTEGER);
    myClaim = { id: selfId, score: scoreCandidate(candidate || {}), joinOrder };
    return myClaim;
  }

  function cancelElection() {
    electing = false;
    claimDeadline = 0;
    claims.clear();
    votes.clear();
    if (claimTimer != null) clearTimeoutFn(claimTimer);
    claimTimer = null;
  }

  function beginElection() {
    if (!running || electing || promoted) return;
    electing = true;
    claims.clear();
    votes.clear();
    const mine = selfClaim();
    claims.set(selfId, mine);
    claimDeadline = now() + claimWindowMs;
    emitter.emit('host-lost', { since: lastHostSeen, at: now() });
    safeSend(CLAIM, { score: mine.score, joinOrder: mine.joinOrder });
    claimTimer = setTimeoutFn(resolve, claimWindowMs);
  }

  function resolve() {
    if (!electing) return;
    let best = myClaim || selfClaim();
    for (const claim of claims.values()) if (beats(claim, best)) best = claim;
    cancelElection();
    if (best.id === selfId) {
      promote();
      return;
    }
    // Loser: reset and give the winner a full timeout to announce itself, so a
    // slow VICTORY does not immediately trigger a second election.
    leaderId = best.id;
    lastHostSeen = now();
    emitter.emit('elected', { leader: best.id, self: false });
  }

  function sendVictory() {
    lastVictorySentAt = now();
    let snapshot = null;
    try {
      snapshot = getSnapshot?.() ?? null;
    } catch {
      snapshot = null;
    }
    // The score rides along so a peer receiving two VICTORYs can apply the same
    // total order it would have applied to the claims.
    safeSend(VICTORY, {
      snapshot,
      score: myClaim?.score ?? 0,
      joinOrder: myClaim?.joinOrder ?? Number.MAX_SAFE_INTEGER,
    });
  }

  function promote() {
    promoted = true;
    leaderId = selfId;
    lastHostSeen = now();
    sendVictory();
    emitter.emit('elected', { leader: selfId, self: true });
    emitter.emit('promote', { id: selfId, score: myClaim?.score ?? 0 });
  }

  /**
   * Called on every PING or PATCH from the host. Host traffic during an
   * election means the host was never gone — stand down rather than split the
   * party in two.
   */
  function noteHostSeen(fromId = null) {
    lastHostSeen = now();
    if (fromId) leaderId = fromId;
    if (electing && !promoted) cancelElection();
  }

  function tick() {
    if (!running || promoted) return;
    if (electing) {
      if (claimDeadline && now() >= claimDeadline) resolve();
      return;
    }
    if (now() - lastHostSeen > hostTimeoutMs) beginElection();
  }

  function claimFrom(f, defaults = {}) {
    const body = f?.body || {};
    return {
      id: String(f?.from || ''),
      score: num(body.score, defaults.score ?? 0),
      joinOrder: num(body.joinOrder, defaults.joinOrder ?? Number.MAX_SAFE_INTEGER),
    };
  }

  function handleClaim(f) {
    if (!f || typeof f !== 'object' || typeof f.from !== 'string' || f.from === selfId) return;
    const rival = claimFrom(f);
    if (!rival.id) return;
    if (promoted) {
      // Somebody thinks we are dead. If we outrank them, say so; if we do not,
      // let them win their own election and yield to their VICTORY.
      const mine = myClaim || selfClaim();
      if (beats(mine, rival) && now() - lastVictorySentAt > claimWindowMs) sendVictory();
      return;
    }
    // A rival claim is itself evidence the host is gone: join in rather than
    // wait out our own timeout, so every peer's window covers the same claims.
    if (!electing) beginElection();
    if (!electing) return;
    claims.set(rival.id, rival);
  }

  /**
   * Votes are advisory. The winner is a function of the claims, so counting
   * them is not needed for correctness — they are kept only for diagnostics.
   */
  function handleVote(f) {
    if (!f || typeof f !== 'object' || typeof f.from !== 'string') return;
    const forId = f.body?.forId;
    if (typeof forId !== 'string' || !forId) return;
    votes.set(f.from, forId);
  }

  function handleVictory(f) {
    if (!f || typeof f !== 'object' || typeof f.from !== 'string' || f.from === selfId) return;
    // An unscored VICTORY is treated as unbeatable: yielding to a host that is
    // already serving is always safe, promoting a second one never is.
    const theirs = claimFrom(f, { score: Infinity, joinOrder: -1 });
    if (!theirs.id) return;
    const mine = myClaim || selfClaim();

    if (promoted && beats(mine, theirs)) {
      // Already hosting and strictly better: re-assert once instead of yielding.
      // The total order guarantees only one peer can take this branch, so the
      // exchange terminates rather than ping-ponging.
      if (now() - lastVictorySentAt > claimWindowMs) sendVictory();
      return;
    }

    cancelElection();
    const wasPromoted = promoted;
    promoted = false;
    leaderId = theirs.id;
    lastHostSeen = now();
    if (wasPromoted) emitter.emit('demote', { leader: theirs.id });
    emitter.emit('elected', { leader: theirs.id, self: false });
  }

  function start() {
    if (running) return;
    running = true;
    lastHostSeen = now();
    watchTimer = setIntervalFn(tick, watchIntervalMs);
  }

  function stop() {
    running = false;
    cancelElection();
    if (watchTimer != null) clearIntervalFn(watchTimer);
    watchTimer = null;
  }

  return {
    start,
    stop,
    tick,
    noteHostSeen,
    handleClaim,
    handleVote,
    handleVictory,
    isElecting: () => electing,
    isPromoted: () => promoted,
    leader: () => leaderId,
    onHostLost: (fn) => emitter.on('host-lost', fn),
    onPromote: (fn) => emitter.on('promote', fn),
    onDemote: (fn) => emitter.on('demote', fn),
    on: emitter.on,
    stats: () => ({
      running,
      electing,
      promoted,
      leader: leaderId,
      lastHostSeen,
      score: myClaim?.score ?? null,
      claims: claims.size,
      votes: votes.size,
    }),
  };
}
