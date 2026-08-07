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
    this.probes = [];
    this.failed = new Set();
    this.opened = new Set();
    this.subs = new Map();
    this.controller = null;
    this.replaying = false;
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

    for (const t of candidates) {
      if (this.failed.has(t.name)) continue;
      if (!this.probeOf(t.name)?.available) continue;
      if (await this.openTransport(t)) return t;
    }
    return this.active; // null only if even the offline queue is absent
  }

  /**
   * Send over the active transport. One failure costs one failover and one
   * retry; a second failure parks the envelope in the offline queue.
   */
  async send(sealed) {
    const first = this.active;
    if (first && this.usable(first) && (await this.trySend(first, sealed))) {
      return this.result(first);
    }

    const next = await this.failover(first);
    if (next && next !== first && (await this.trySend(next, sealed))) {
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

  stats() {
    return {
      active: this.activeName(),
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
      t.on('message', (sealed) => this.onMessage(sealed)),
      t.on('signal', (msg) => this.onSignal(msg)),
      t.on('status', ({ status, detail }) => {
        this.onStatus({ name: t.name, status, detail: detail || null, active: t === this.active });
        if (status === STATUS.READY && t === this.active) this.replay().catch(noop);
      }),
    ]);
  }

  unbind(t) {
    for (const off of this.subs.get(t.name) || []) off();
    this.subs.delete(t.name);
  }

  async openTransport(t) {
    this.bind(t);
    try {
      await t.open(this.ctx());
      this.opened.add(t.name);
      this.active = t;
      // The READY stamp landed before `active` was set, so the bound listener
      // reported it as inactive and skipped the replay. Re-announce with the
      // right flag and run the replay here instead.
      this.onStatus({ name: t.name, status: t.status, detail: null, active: true });
      if (t.status === STATUS.READY) await this.replay();
      return true;
    } catch (err) {
      this.failed.add(t.name);
      t.fail(err);
      this.unbind(t);
      this.log('open failed', t.name, String(err?.message || err));
      return false;
    }
  }

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

  /** Retire the current transport and open the next usable one by rank. */
  async failover(from) {
    const previous = from || this.active;
    if (previous) {
      this.failed.add(previous.name);
      await this.retire(previous);
    }
    this.active = null;

    for (const t of this.registry.list()) {
      if (t === previous || this.failed.has(t.name)) continue;
      // A transport never probed (failover before connect) still gets a turn;
      // one probed unavailable does not, until the next connect().
      if (this.probeOf(t.name)?.available === false) continue;
      if (await this.openTransport(t)) return t;
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
