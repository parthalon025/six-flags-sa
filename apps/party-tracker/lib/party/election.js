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

/** Score delta of one 1% battery step after quantise (`W_BATTERY * 0.01`). */
const BATTERY_STEP = W_BATTERY / 100;

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
 *
 * Exported because the same order has to hold after a promotion, when the
 * election object is gone and the runtime is comparing two live hosts.
 */
export function outranks(a, b) {
  if (a.score !== b.score) return a.score > b.score;
  if (a.joinOrder !== b.joinOrder) return a.joinOrder < b.joinOrder;
  return a.id < b.id;
}

/** How many 1% battery steps a challenger must beat the incumbent by before a silent steal. */
export const STEAL_STEPS = 5;

/** Defaults for a frame that carries no rank numbers — serving host is unbeatable. */
export const UNSCORED_RANK_DEFAULTS = { score: Infinity, joinOrder: -1 };

/**
 * True when the challenger should take Host: strictly better, and by enough
 * that a 1% battery wobble does not flap the mesh.
 */
export function shouldYield(incumbent, challenger) {
  if (!incumbent || !challenger) return false;
  if (!outranks(challenger, incumbent)) return false;
  return challenger.score - incumbent.score >= STEAL_STEPS * BATTERY_STEP;
}

/**
 * Id of a device-holding Member who should take Host from `leaderId`, or null.
 * Uses battery (and join order) from the roster — radio scores stay off the wire.
 */
export function betterHost(members, leaderId) {
  const list = Object.values(members || {}).filter((m) => m && !m.deviceLess && m.id);
  if (!list.length) return null;
  const claim = (m) => ({
    id: m.id,
    // Missing battery is middling (same as a client with no Battery API), not
    // a zero that would lose Host to any phone that can read a percent.
    score: scoreCandidate({ battery: m.battery ?? 0.5, joinOrder: m.joinOrder }),
    joinOrder: Number.isFinite(m.joinOrder) ? m.joinOrder : 1e6,
  });
  const leader = list.find((m) => m.id === leaderId);
  const incumbent = leader
    ? claim(leader)
    : { id: leaderId, score: 0, joinOrder: 1e6 };
  let best = incumbent;
  for (const m of list) {
    const next = claim(m);
    if (shouldYield(best, next)) best = next;
  }
  return best.id !== leaderId ? best.id : null;
}

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/**
 * The rank a frame is asserting: `{ id, score, joinOrder }`.
 *
 * `defaults` is the caller's policy for a frame that carries no numbers. A
 * VICTORY or a host beacon without them is treated as unbeatable, because
 * yielding to a peer that is already serving is always safe and promoting a
 * second host never is.
 */
export function readRank(f, defaults = {}) {
  const body = f?.body || {};
  return {
    id: String(f?.from || ''),
    score: num(body.score, defaults.score ?? 0),
    joinOrder: num(body.joinOrder, defaults.joinOrder ?? Number.MAX_SAFE_INTEGER),
  };
}

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
  /** Bumped per election so a claim that lands late cannot open the next one's window. */
  let round = 0;
  /**
   * Floor between re-assertions by a peer that is already hosting. Small enough
   * that a fresh election can never run unopposed — a rival needs the whole
   * `hostTimeoutMs` of silence before it even claims — and large enough that a
   * burst of claims cannot turn into a burst of victories.
   */
  const reassertGapMs = hostTimeoutMs / 8;
  /**
   * How long past the claim window an election waits for its own claim to reach
   * the wire before resolving blind. Only reached when the transport is wedged;
   * the reconciliation on the far side of a promotion is what makes resolving
   * blind survivable rather than fatal.
   */
  const claimBackstopMs = hostTimeoutMs;
  let myClaim = null;
  let watchTimer = null;
  let claimTimer = null;

  /** @returns whatever `send` returned — a promise, if the transport reports delivery. */
  function safeSend(kind, body) {
    try {
      return send?.(kind, body, EVERYONE) ?? null;
    } catch {
      // A transport that cannot carry the claim will time out on its own; the
      // election must not die on the way out.
      return null;
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

  /**
   * Open the window in which rival claims are collected.
   *
   * It runs from the moment our own claim is actually on the wire, not from the
   * moment it was handed to the transport. Those are the same thing only when
   * the party has a working broadcast path; when the host dies, the path the
   * transport was using may have died with it, and resolving before a rival
   * could possibly have heard us is exactly how two peers each elect
   * themselves.
   */
  function openClaimWindow(forRound) {
    if (!electing || forRound !== round) return;
    claimDeadline = now() + claimWindowMs;
    if (claimTimer != null) clearTimeoutFn(claimTimer);
    claimTimer = setTimeoutFn(resolve, claimWindowMs);
  }

  function beginElection() {
    if (!running || electing || promoted) return;
    electing = true;
    claims.clear();
    votes.clear();
    const mine = selfClaim();
    claims.set(selfId, mine);
    round += 1;
    const thisRound = round;
    // Backstop, armed before the claim goes out for two reasons: a still-living
    // host answers a claim synchronously on a local transport and the
    // cancellation that follows has to be able to find this timer, and a
    // transport that never reports the claim as delivered must not leave the
    // party with no host at all.
    claimDeadline = now() + claimWindowMs + claimBackstopMs;
    claimTimer = setTimeoutFn(resolve, claimWindowMs + claimBackstopMs);
    emitter.emit('host-lost', { since: lastHostSeen, at: now() });
    const sending = safeSend(CLAIM, { score: mine.score, joinOrder: mine.joinOrder });
    // A transport that answers with a promise is telling us when the claim left.
    // One that answers with nothing cannot, so its claim counts as sent now.
    if (typeof sending?.then === 'function') {
      sending.then(
        () => openClaimWindow(thisRound),
        () => openClaimWindow(thisRound),
      );
    } else {
      openClaimWindow(thisRound);
    }
  }

  function resolve() {
    if (!electing) return;
    let best = myClaim || selfClaim();
    for (const claim of claims.values()) if (outranks(claim, best)) best = claim;
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
    // The rank travels with the promotion: the host service that replaces this
    // election has to be able to defend the same total order against a peer
    // that promoted itself at the same moment.
    emitter.emit('promote', {
      id: selfId,
      score: myClaim?.score ?? 0,
      joinOrder: myClaim?.joinOrder ?? Number.MAX_SAFE_INTEGER,
    });
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

  function handleClaim(f) {
    if (!f || typeof f !== 'object' || typeof f.from !== 'string' || f.from === selfId) return;
    const rival = readRank(f);
    if (!rival.id) return;
    if (promoted) {
      // Somebody thinks we are dead. If we outrank them, say so; if we do not,
      // let them win their own election and yield to their VICTORY.
      const mine = myClaim || selfClaim();
      if (outranks(mine, rival) && now() - lastVictorySentAt >= reassertGapMs) sendVictory();
      return;
    }
    if (!electing) {
      // A rival claim is evidence the host is gone, but only corroborating
      // evidence: peers all stopped hearing the same host at the same moment,
      // so a claim while our own timer still has more than one claim window to
      // run means that peer is wrong, not that we are late. Joining in there is
      // how a party that has just agreed on a host tears itself apart again.
      if (now() - lastHostSeen <= Math.max(0, hostTimeoutMs - claimWindowMs)) return;
      beginElection();
      if (!electing) return;
    }
    claims.set(rival.id, rival);
    publishFrontRunner();
  }

  /**
   * Name the best claim heard so far, before the window closes.
   *
   * A peer that has been outclaimed already knows it will not be hosting, and
   * every claim after that can only confirm it or replace it with someone
   * better. Saying so now is what keeps two phones from spending a claim window
   * each pointing at a host that has been in a locker for fifteen seconds — the
   * winner's VICTORY corrects anyone who guessed early, and nothing here decides
   * anything: `resolve` still ranks the whole set.
   */
  function publishFrontRunner() {
    let best = myClaim || selfClaim();
    for (const claim of claims.values()) if (outranks(claim, best)) best = claim;
    if (best.id === selfId || best.id === leaderId) return;
    leaderId = best.id;
    emitter.emit('front-runner', { leader: best.id });
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
    const theirs = readRank(f, UNSCORED_RANK_DEFAULTS);
    if (!theirs.id) return;
    const mine = myClaim || selfClaim();

    if (promoted) {
      if (outranks(theirs, mine)) {
        cancelElection();
        const wasPromoted = promoted;
        promoted = false;
        leaderId = theirs.id;
        lastHostSeen = now();
        if (wasPromoted) emitter.emit('demote', { leader: theirs.id });
        emitter.emit('elected', { leader: theirs.id, self: false });
        return;
      }
      // Already hosting and still ahead on the total order: re-assert once.
      if (outranks(mine, theirs) && now() - lastVictorySentAt >= reassertGapMs) sendVictory();
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
