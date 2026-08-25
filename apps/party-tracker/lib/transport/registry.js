/**
 * The pluggable transport framework: registration, selection, failover, replay.
 *
 * No 'use client' and no browser API in this file on purpose — the manager is
 * pure orchestration over the transport contract, so the Node tests can drive
 * it with fake transports and get exactly the behaviour a phone gets.
 *
 * The whole design rests on one invariant: **a send never fails silently**. If
 * the active transport cannot carry an envelope, the manager fails over and
 * retries once; if nothing at all is usable, the envelope goes to the offline
 * queue and is replayed, in order, the moment something reaches READY.
 *
 * One transport is active — the send path, and the one `activeName()` reports.
 * Others may be *warm*: open, subscribed, not sending. Warmth exists because
 * "which transport is best" is not a question that can be answered once at the
 * gate. Two cases, both of which used to break a party outright:
 *
 *   - WebRTC declares `standby`, meaning its signaling has to keep running
 *     whatever is carrying envelopes. Close it and a host can never accept a
 *     direct channel again, so a single early failover took every party to the
 *     cloud permanently. Kept warm, it reports READY when a channel opens and
 *     the manager moves traffic onto it (`carries()`), and back off it if the
 *     channel drops.
 *   - A host also keeps the best mailbox warm. A joiner posts its HELLO before
 *     it knows whether a direct channel is possible, and a host that is not
 *     listening there loses the frame that the entire join depends on. The host
 *     mirrors its broadcasts back down any warm path it has recently heard a
 *     peer on, which is what keeps a mixed party — one phone direct, one on the
 *     relay — working in both directions without putting every byte in the
 *     cloud forever.
 */

import { RANK, STATUS } from './types.js';

export function createRegistry() {
  const byName = new Map();
  return {
    register(transport) {
      if (!transport?.name) throw new Error('registry: transport needs a name');
      byName.set(transport.name, transport);
      return transport;
    },
    /** Ascending rank — this is also the order selection tries them in. */
    list: () => [...byName.values()].sort((a, b) => a.rank - b.rank),
    get: (name) => byName.get(name) || null,
  };
}

const noop = () => {};

/**
 * How long after hearing from a peer on a warm path the host keeps mirroring
 * its broadcasts down it. Long enough to cover a heartbeat gap, short enough
 * that a party which has gone fully direct stops paying for the relay.
 */
const MIRROR_WINDOW_MS = 30000;

/** A transport that is open and working, even if it is working badly. */
const live = (status) => status === STATUS.READY || status === STATUS.DEGRADED;

/**
 * Selection and failover across registered transports.
 *
 * Construct with `new TransportManager({ transports, session, onMessage,
 * onStatus, log })`, or use the `createTransportManager` factory below if you
 * prefer not to use `new`. `transports` accepts either an array of transports
 * or an existing registry.
 *
 * Optional `onSignal` receives non-envelope mailbox traffic (WebRTC SDP/ICE),
 * which is not part of the transport contract but is emitted by the mailbox
 * transports and has to go somewhere.
 */
export class TransportManager {
  constructor({ transports = [], session = null, onMessage, onStatus, onSignal, log } = {}) {
    this.registry = typeof transports?.list === 'function' ? transports : createRegistry();
    if (Array.isArray(transports)) for (const t of transports) this.registry.register(t);

    this.session = session;
    this.onMessage = onMessage || noop;
    this.onStatus = onStatus || noop;
    this.onSignal = onSignal || noop;
    this.log = log || noop;

    this.active = null;
    this.warm = new Set();
    this.lastRx = new Map(); // transport name -> when a peer was last heard there
    this.probes = [];
    this.failed = new Set();
    this.opened = new Set();
    this.subs = new Map();
    this.controller = null;
    this.replaying = false;
    this.warming = null;
  }

  /* ------------------------------------------------------------ public ---- */

  /**
   * Probe everything in parallel, then open in ascending rank order and stop at
   * the first success. Probing in parallel matters: a dead LAN address must not
   * delay the cloud relay's answer, only its own turn in the open loop.
   */
  async connect() {
    if (!this.controller && typeof AbortController === 'function') this.controller = new AbortController();
    // connect() is the "try everything again" entry point, so past failures stop
    // counting here — a relay that was down at the gate may be up by the queue.
    this.failed.clear();
    if (this.active) await this.retire(this.active);
    const candidates = this.registry.list();

    this.probes = await Promise.all(
      candidates.map(async (t) => {
        const at = Date.now();
        try {
          const result = await t.probe(this.ctx());
          return { name: t.name, rank: t.rank, available: Boolean(result?.available), reason: result?.reason || null, at };
        } catch (err) {
          return { name: t.name, rank: t.rank, available: false, reason: String(err?.message || err), at };
        }
      }),
    );

    // A host that lands on WebRTC with no peer yet still has to hear HELLO on
    // the mailbox. Warming that path in parallel with selection means a joiner
    // does not race a PING that found nobody on the direct channel.
    // Standby paths only before selection — warming a mailbox here can claim the
    // single inbox slot for the transport the loop below is about to activate.
    if (this.role() === 'host') this.warmUp({ standbysOnly: true }).catch(noop);

    for (const t of candidates) {
      if (this.failed.has(t.name)) continue;
      if (!this.probeOf(t.name)?.available) continue;
      if (await this.openTransport(t)) break;
    }
    // Deliberately not awaited: warming is a background concern and a joiner
    // must not wait on it to be considered connected.
    this.warmUp().catch(noop);
    return this.active; // null only if even the offline queue is absent
  }

  /**
   * Send over the active transport. One failure costs one failover and one
   * retry; a second failure parks the envelope in the offline queue.
   */
  async send(sealed) {
    const first = this.active;
    if (first && this.usable(first) && (await this.trySend(first, sealed))) {
      this.mirror(sealed);
      return this.result(first);
    }

    const next = await this.failover(first);
    if (next && next !== first && (await this.trySend(next, sealed))) {
      this.mirror(sealed);
      return this.result(next);
    }

    await this.enqueue(sealed);
    return { ok: false, queued: true, via: this.offline()?.name || null };
  }

  /**
   * Push everything the offline queue is holding through the active transport,
   * oldest first. Called automatically on every transition to READY.
   */
  async replay() {
    const offline = this.offline();
    const active = this.active;
    if (!offline || !active || active === offline || this.replaying) return 0;
    if (typeof offline.drain !== 'function' || offline.size?.() === 0) return 0;

    this.replaying = true;
    const pending = offline.drain();
    let sent = 0;
    try {
      for (let i = 0; i < pending.length; i += 1) {
        try {
          await active.send(pending[i]);
          sent += 1;
        } catch (err) {
          // Return the unsent tail to the queue in order. Anything enqueued
          // while the replay was running sorts ahead of it, which reorders at
          // most one batch and never drops one.
          for (const item of pending.slice(i)) await offline.send(item);
          this.log('replay stalled', active.name, String(err?.message || err));
          break;
        }
      }
    } finally {
      this.replaying = false;
    }
    if (sent) this.log('replayed', sent, 'via', active.name);
    return sent;
  }

  activeName() {
    return this.active?.name || null;
  }

  /** Names of the transports held open behind the active one. */
  warmNames() {
    return [...this.warm].map((t) => t.name);
  }

  stats() {
    return {
      active: this.activeName(),
      warm: this.warmNames(),
      candidates: this.registry.list().map((t) => t.stats()),
      probes: this.probes,
    };
  }

  async close() {
    this.controller?.abort();
    this.controller = null;
    for (const t of this.registry.list()) {
      this.unbind(t);
      if (!this.opened.has(t.name)) continue;
      try {
        await t.close();
      } catch (err) {
        this.log('close failed', t.name, String(err?.message || err));
      }
    }
    this.opened.clear();
    this.warm.clear();
    this.lastRx.clear();
    this.active = null;
  }

  /* ---------------------------------------------------------- internal ---- */

  ctx() {
    return {
      session: this.session,
      role: this.session?.role || null,
      signal: this.controller?.signal,
      log: this.log,
    };
  }

  role() {
    return this.session?.role || null;
  }

  offline() {
    return this.registry.list().find((t) => t.rank === RANK.OFFLINE || t.name === 'offline') || null;
  }

  probeOf(name) {
    return this.probes.find((p) => p.name === name) || null;
  }

  usable(t) {
    return !this.failed.has(t.name) && t.status !== STATUS.FAILED && t.status !== STATUS.CLOSED;
  }

  /** `ok` means it left this device; landing in the outbox is `queued`, not sent. */
  result(t) {
    const queued = t === this.offline();
    return { ok: !queued, via: t.name, queued };
  }

  bind(t) {
    if (this.subs.has(t.name)) return;
    this.subs.set(t.name, [
      t.on('message', (sealed) => {
        this.lastRx.set(t.name, Date.now());
        this.onMessage(sealed);
      }),
      t.on('signal', (msg) => this.onSignal(msg)),
      t.on('status', ({ status, detail }) => {
        this.onStatus({ name: t.name, status, detail: detail || null, active: t === this.active });
        if (t === this.active) {
          if (live(status)) this.replay().catch(noop);
          return;
        }
        // A standby transport that comes good has earned another turn, whatever
        // it did earlier in the session.
        if (status === STATUS.READY && t.standby) this.failed.delete(t.name);
        if (this.warm.has(t)) this.consider(t);
      }),
    ]);
  }

  unbind(t) {
    for (const off of this.subs.get(t.name) || []) off();
    this.subs.delete(t.name);
  }

  /**
   * Open a transport. `activate` false opens it as a warm path instead of the
   * send path: same subscriptions, same lifecycle, no traffic.
   */
  async openTransport(t, activate = true) {
    this.bind(t);
    try {
      await t.open(this.ctx());
      this.opened.add(t.name);
      if (!activate) {
        this.warm.add(t);
        this.consider(t);
        return true;
      }
      this.warm.delete(t);
      this.active = t;
      // The READY stamp landed before `active` was set, so the bound listener
      // reported it as inactive and skipped the replay. Re-announce with the
      // right flag and run the replay here instead.
      this.onStatus({ name: t.name, status: t.status, detail: null, active: true });
      if (live(t.status)) await this.replay();
      return true;
    } catch (err) {
      // A standby transport that has not given up is not a failure, it is a
      // slow success: it stays open, stays subscribed, and says so later.
      // A joiner's open timeout is one of those cases — fail over immediately
      // without waiting on a data channel that is not there yet.
      if (t.standby && t.status !== STATUS.FAILED) {
        this.opened.add(t.name);
        this.warm.add(t);
        this.log('still negotiating', t.name, String(err?.message || err));
        return false;
      }
      this.failed.add(t.name);
      t.fail(err);
      this.unbind(t);
      this.log('open failed', t.name, String(err?.message || err));
      return false;
    }
  }

  /* -------------------------------------------------------------- warmth -- */

  /**
   * Transports that must be open even though they are not the send path: every
   * `standby` one, plus — for a host — the best mailbox a joiner might arrive
   * on. Anything never probed, probed unavailable, or already written off is
   * not a candidate.
   */
  desiredWarm({ standbysOnly = false } = {}) {
    const out = [];
    let wantInbox = this.role() === 'host' && !standbysOnly;
    for (const t of this.registry.list()) {
      if (t === this.active || t.rank === RANK.OFFLINE) continue;
      if (this.probeOf(t.name)?.available !== true) continue;
      if (t.standby) {
        if (!this.failed.has(t.name) || this.warm.has(t)) out.push(t);
        continue;
      }
      if (wantInbox && !this.failed.has(t.name)) {
        out.push(t);
        wantInbox = false;
      }
    }
    return out;
  }

  /** Open whatever `desiredWarm` names and is not open already. */
  async warmUp(options = {}) {
    if (this.warming) return this.warming.then(() => this.warmUp(options));
    const wanted = this.desiredWarm(options).filter((t) => !this.warm.has(t) && t !== this.active);
    if (!wanted.length) return null;
    this.warming = Promise.all(wanted.map((t) => this.openTransport(t, false).catch(noop))).finally(() => {
      this.warming = null;
    });
    return this.warming;
  }

  /** Promote a warm transport if it now outranks what is carrying traffic. */
  consider(t) {
    if (!this.warm.has(t) || !this.usable(t)) return;
    if (t.carries?.() !== true) return;
    if (this.active && this.active.rank <= t.rank) return;
    this.activate(t).catch((err) => this.log('upgrade failed', t.name, String(err?.message || err)));
  }

  /** Move the send path onto an already-open transport. */
  async activate(t) {
    const previous = this.active;
    if (previous === t) return;
    this.warm.delete(t);
    this.active = t;
    this.log('active transport', t.name, previous ? `(was ${previous.name})` : '');
    this.onStatus({ name: t.name, status: t.status, detail: 'upgraded', active: true });
    if (previous) {
      // Keep it if it is still wanted — a host needs its mailbox inbox whatever
      // is carrying envelopes — and close it if it is not.
      if (this.desiredWarm().includes(previous)) this.warm.add(previous);
      else await this.retire(previous);
    }
    // Nothing is lost across the switch: anything the old path could not take
    // is in the outbox, and this is where it goes out.
    await this.replay();
  }

  /**
   * Warm paths the host should also broadcast down: ones a peer has actually
   * been heard on recently. A party that has gone fully direct stops mirroring
   * on its own once the window lapses, which is what keeps the cloud out of a
   * conversation that no longer needs it.
   */
  mirrors() {
    if (this.role() !== 'host') return [];
    const cut = Date.now() - MIRROR_WINDOW_MS;
    return [...this.warm].filter(
      (t) => t !== this.active && this.usable(t) && (this.lastRx.get(t.name) || 0) > cut,
    );
  }

  mirror(sealed) {
    for (const t of this.mirrors()) {
      // Fire and forget: this copy is redundant by construction, and a failure
      // here says nothing about whether the frame was delivered.
      Promise.resolve(t.send(sealed)).catch((err) =>
        this.log('mirror failed', t.name, String(err?.message || err)),
      );
    }
  }

  /* ------------------------------------------------------------ failover -- */

  async trySend(t, sealed) {
    try {
      await t.send(sealed);
      return true;
    } catch (err) {
      this.log('send failed', t.name, String(err?.message || err));
      t.fail(err);
      this.failed.add(t.name);
      return false;
    }
  }

  /** Unbind and close one transport, leaving nothing active. */
  async retire(t) {
    if (!t) return;
    this.unbind(t);
    this.warm.delete(t);
    this.lastRx.delete(t.name);
    if (this.opened.has(t.name)) {
      this.opened.delete(t.name);
      try {
        await t.close();
      } catch (err) {
        this.log('close failed', t.name, String(err?.message || err));
      }
    }
    if (this.active === t) this.active = null;
  }

  /** Retire the current transport and take the next usable one by rank. */
  async failover(from) {
    const previous = from || this.active;
    if (previous) {
      this.failed.add(previous.name);
      if (previous.standby && previous.status !== STATUS.FAILED && this.opened.has(previous.name)) {
        // Demote rather than close: whatever went wrong with the data channel,
        // the signaling underneath it is the only route back to a direct link.
        this.warm.add(previous);
      } else {
        await this.retire(previous);
      }
    }
    this.active = null;

    for (const t of this.registry.list()) {
      if (t === previous || this.failed.has(t.name)) continue;
      // A transport never probed (failover before connect) still gets a turn;
      // one probed unavailable does not, until the next connect().
      if (this.probeOf(t.name)?.available === false) continue;
      if (this.warm.has(t)) {
        // Already open. It only takes over if it can actually carry something.
        if (t.carries?.() === false) continue;
        await this.activate(t);
        return t;
      }
      if (await this.openTransport(t)) {
        this.warmUp().catch(noop);
        return t;
      }
    }
    return null;
  }

  async enqueue(sealed) {
    const offline = this.offline();
    if (!offline) {
      this.log('dropped: no offline queue registered');
      return false;
    }
    if (!this.opened.has(offline.name)) {
      try {
        await offline.open(this.ctx());
        this.opened.add(offline.name);
      } catch {
        // The offline queue's open cannot fail by contract; if it somehow does,
        // send() below still works against the in-memory copy.
      }
    }
    await offline.send(sealed);
    return true;
  }
}

/** Same thing without `new`, for call sites that prefer factories. */
export const createTransportManager = (options) => new TransportManager(options);
