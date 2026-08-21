/**
 * A sealed-envelope bus for driving real host/client services in Node.
 *
 * The party protocol is peer-to-peer over a transport that only has to move
 * opaque bytes, so a Map and a loop is a faithful stand-in for a radio. Real
 * `seal`/`open`, real hostService, real client, real election — only the wire
 * is a fake, which is the point: everything a phone runs is under test.
 *
 * `partition()` is the whole reason this exists. Losing the host is not a
 * message, it is the absence of one, and the only way to write that down is to
 * stop delivering.
 */

const APP = new URL('../../../apps/party-tracker/', import.meta.url);
const load = (rest) => import(new URL(rest, APP).href);

const { generateKey } = await load('lib/core/crypto.js');

/**
 * The real timer, grabbed before `captureTimers` can replace it. `settle()`
 * yields the macrotask queue, and it has to keep working while the party's own
 * timers are hand-cranked — otherwise the harness deadlocks on itself.
 */
const REAL_SET_TIMEOUT = globalThis.setTimeout;
const yieldTask = () => new Promise((resolve) => REAL_SET_TIMEOUT(resolve, 0));

export async function partyKey() {
  return generateKey();
}

export function createBus() {
  /** peerId -> (sealed) => Promise, the service currently answering for it. */
  const peers = new Map();
  const offline = new Set();
  /** Every envelope handed to the bus: [{ from, sealed }]. */
  const wire = [];
  let inflight = [];

  const bus = {
    wire,
    /** Point a peer id at whichever service is serving it now. Migration re-points. */
    attach(id, service) {
      peers.set(id, service);
    },
    detach(id) {
      peers.delete(id);
    },
    /** This peer neither sends nor receives — a phone in a locker. */
    partition(id) {
      offline.add(id);
    },
    heal(id) {
      offline.delete(id);
    },
    isPartitioned: (id) => offline.has(id),

    /**
     * The transport facade hostService and client are handed. Mirrors the
     * shape partyRuntime's `createLink` exposes (partyRuntime.js:445-505):
     * connect/send/activeName/stats, plus the mute/reselect it adds.
     */
    link(id) {
      const state = { muted: false, connects: 0, reselects: 0 };
      const api = {
        state,
        connect: async () => {
          state.connects += 1;
          return null;
        },
        reselect: async () => {
          state.reselects += 1;
          return null;
        },
        mute: () => {
          state.muted = true;
        },
        drain: async () => {},
        activeName: () => 'bus',
        stats: () => ({ active: 'bus' }),
        async send(sealed) {
          if (state.muted) return { ok: false, queued: false, via: null };
          wire.push({ from: id, sealed });
          if (offline.has(id)) return { ok: false, queued: true, via: 'bus' };
          for (const [peerId, service] of peers) {
            if (peerId === id || offline.has(peerId)) continue;
            inflight.push(Promise.resolve(service(sealed)).catch(() => null));
          }
          return { ok: true, queued: false, via: 'bus' };
        },
      };
      return api;
    },

    /** Wait for every delivery started so far, including ones they triggered. */
    async settle(turns = 8) {
      for (let i = 0; i < turns; i += 1) {
        const batch = inflight;
        inflight = [];
        await Promise.all(batch);
        await yieldTask();
      }
    },
  };
  return bus;
}

/**
 * Replace the global interval/timeout functions with hand-cranked ones.
 *
 * Needed because `createClient` forwards only `now` to its election and takes
 * no timer injection of its own (client.js:42, :343-348) — unlike
 * `createHostService` (setIntervalFn/clearIntervalFn) and `createElection`
 * (all four). Recorded as a finding: this monkey-patch is standing in for a
 * seam that should exist.
 */
export function captureTimers() {
  const real = {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const intervals = new Map();
  const timeouts = new Map();
  let next = 1;

  globalThis.setInterval = (fn, ms) => {
    const id = next++;
    intervals.set(id, { fn, ms });
    return id;
  };
  globalThis.clearInterval = (id) => intervals.delete(id);
  globalThis.setTimeout = (fn, ms) => {
    const id = next++;
    timeouts.set(id, { fn, ms });
    return id;
  };
  globalThis.clearTimeout = (id) => timeouts.delete(id);

  return {
    intervals,
    timeouts,
    /** Run every live interval callback once, as one wall-clock tick would. */
    tick() {
      for (const { fn } of [...intervals.values()]) fn();
    },
    restore() {
      Object.assign(globalThis, real);
    },
    real,
  };
}
