/**
 * Fake transports for driving lib/transport/registry.js in Node.
 *
 * registry.js:4-6 says it carries no browser API precisely so the Node tests
 * can drive it with fakes and get the behaviour a phone gets. These are those
 * fakes: built on the REAL `defineTransport`, so status, counters and the
 * emitter come from the module under test rather than from a mock.
 *
 * On the contract gap. `defineTransport` (types.js:9-124) is the written
 * contract, and it is a strict SUBSET of what the manager actually branches
 * on. Two members are enforced but undeclared:
 *
 *   - `transport.standby`  (webrtc.js:374) — registry.js:279, :317, :455
 *   - `transport.carries()`(webrtc.js:377) — registry.js:345, :372, :471
 *
 * and the offline queue adds `drain()` / `size()` that `replay()` requires
 * (registry.js:168, :171, :182). `defineTransport` hands back none of them, so
 * every fake below bolts them on by hand — which is the demonstration, not an
 * accident. A transport written to the documented contract alone is silently
 * treated as non-standby and non-carrying.
 */

import { defineTransport, RANK, STATUS } from '../../../apps/party-tracker/lib/transport/types.js';

/**
 * A transport whose every verb is a knob.
 *
 * `probeResult`, `onOpen` and `onSend` are read at call time, so a test can
 * change a transport's mind partway through a run — which is the whole point:
 * a relay that was down at the gate may be up by the queue.
 */
export function fakeTransport({
  name,
  rank,
  available = true,
  reason = null,
  standby = false,
  carries = null,
  openFails = false,
  sendFails = false,
  probeDelayMs = 0,
} = {}) {
  const log = { opens: 0, closes: 0, sent: [] };
  const knobs = { available, reason, openFails, sendFails, probeDelayMs, carries };

  const transport = defineTransport({
    name,
    rank,
    probe: async () => {
      if (knobs.probeDelayMs) await new Promise((r) => setTimeout(r, knobs.probeDelayMs));
      return { available: knobs.available, reason: knobs.reason };
    },
    open: async () => {
      log.opens += 1;
      if (knobs.openFails) throw new Error(`${name}: open refused`);
    },
    send: async (sealed) => {
      // `sendFails` may be a predicate, so a test can fail the Nth send only.
      const refuse =
        typeof knobs.sendFails === 'function' ? knobs.sendFails(sealed, log.sent.length) : knobs.sendFails;
      if (refuse) throw new Error(`${name}: send refused`);
      log.sent.push(sealed);
    },
    close: async () => {
      log.closes += 1;
    },
    describe: () => ({ fake: true }),
  });

  // Not from defineTransport — see the contract-gap note above.
  if (standby) transport.standby = true;
  if (typeof knobs.carries === 'function' || knobs.carries !== null) {
    transport.carries = () => (typeof knobs.carries === 'function' ? knobs.carries() : knobs.carries);
  }

  transport.log = log;
  transport.knobs = knobs;
  /** Pretend a peer said something on this path. Drives the manager's lastRx. */
  transport.receive = (sealed) => transport.deliver(sealed);
  /** Force a status without going through open(), for the warm-path branches. */
  transport.announce = (status, detail) => transport.setStatus(status, detail);
  return transport;
}

/** A minimal offline queue: the drain/size pair `replay()` requires. */
export function fakeOfflineQueue({ name = 'offline', rank = RANK.OFFLINE } = {}) {
  let queue = [];
  const transport = defineTransport({
    name,
    rank,
    probe: async () => ({ available: true }),
    open: async () => {},
    send: async (sealed) => {
      queue.push(sealed);
    },
    close: async () => {},
    describe: () => ({ queued: queue.length }),
  });
  transport.drain = () => {
    const out = queue;
    queue = [];
    return out;
  };
  transport.size = () => queue.length;
  transport.contents = () => [...queue];
  return transport;
}

/** Swap `Date.now` for a hand-cranked clock. registry.js has no injectable one. */
export function fakeClock(startAt = 1_700_000_000_000) {
  const real = Date.now;
  let at = startAt;
  Date.now = () => at;
  return {
    advance: (ms) => {
      at += ms;
      return at;
    },
    restore: () => {
      Date.now = real;
    },
  };
}

export { RANK, STATUS };
