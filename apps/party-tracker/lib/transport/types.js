/**
 * The transport contract. Canonical.
 *
 * Nothing above this layer knows which transport is carrying its bytes, and
 * nothing below it knows what the bytes mean. A transport moves sealed
 * envelopes between this peer and the party, and reports honestly on whether
 * it can do so right now.
 *
 * Every transport is an object shaped like this:
 *
 *   {
 *     name,                     // stable id, e.g. 'webrtc'
 *     rank,                     // lower wins when several are usable
 *     probe(ctx)   -> Promise<{ available, reason? }>
 *     open(ctx)    -> Promise<void>     // must resolve only once usable
 *     send(sealed) -> Promise<void>
 *     close()      -> Promise<void>
 *     on(event, fn)-> () => void        // 'message' | 'status' | 'peer'
 *     stats()      -> object            // for the diagnostics panel
 *   }
 *
 * `ctx` carries the session: { session, role, signal, log }. A transport never
 * reads party state and never decrypts anything — it cannot, it has no key.
 */

/** Selection order. Local first, cloud last, offline as the floor. */
export const RANK = {
  LOCAL_HTTP: 10,
  WEBRTC: 20,
  BLUETOOTH: 30,
  CLOUD_RELAY: 40,
  OFFLINE: 99,
};

export const STATUS = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  READY: 'ready',
  DEGRADED: 'degraded',
  FAILED: 'failed',
  CLOSED: 'closed',
};

/**
 * Minimal event emitter shared by every transport, so `on()` behaves the same
 * everywhere and returns an unsubscribe rather than needing a matching `off`.
 */
export function createEmitter() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch {
          /* a bad listener must not take the transport down */
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

/**
 * Wrap the common bookkeeping every transport needs: status tracking, the
 * emitter, and counters for the diagnostics panel. Implementations supply the
 * verbs and get the nouns for free.
 */
export function defineTransport({ name, rank, probe, open, send, close, describe }) {
  const emitter = createEmitter();
  let status = STATUS.IDLE;
  const counters = { sent: 0, received: 0, errors: 0, opened: 0, lastError: null };

  const self = {
    name,
    rank,
    get status() {
      return status;
    },
    setStatus(next, detail) {
      if (status === next) return;
      status = next;
      emitter.emit('status', { status: next, detail });
    },
    deliver(sealed) {
      counters.received += 1;
      emitter.emit('message', sealed);
    },
    fail(err) {
      counters.errors += 1;
      counters.lastError = String(err?.message || err);
      self.setStatus(STATUS.FAILED, counters.lastError);
    },
    probe: (ctx) => probe(ctx, self),
    async open(ctx) {
      self.setStatus(STATUS.CONNECTING);
      await open(ctx, self);
      counters.opened += 1;
      self.setStatus(STATUS.READY);
    },
    async send(sealed) {
      await send(sealed, self);
      counters.sent += 1;
    },
    async close() {
      await close(self);
      self.setStatus(STATUS.CLOSED);
      emitter.clear();
    },
    on: emitter.on,
    emit: emitter.emit,
    stats: () => ({ name, rank, status, ...counters, ...(describe?.(self) || {}) }),
  };
  return self;
}
