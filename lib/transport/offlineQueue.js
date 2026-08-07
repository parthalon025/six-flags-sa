'use client';

/**
 * The floor of the selection order: a durable outbox.
 *
 * This transport never moves a byte. It exists so that "nothing is reachable"
 * is an ordinary state rather than an error path — sends land in a queue that
 * survives a reload, and the manager replays them in order the moment a real
 * transport comes up. That is why it is always available and its `open` can
 * never fail; if this one could fail, message loss would have a hiding place.
 *
 * The queue is bounded. When it is full the OLDEST envelope is dropped: in a
 * park the newest location is the one worth keeping, and an hour-old heartbeat
 * is worth less than the storage it occupies.
 */

import { defineTransport, RANK } from './types.js';

export function createOfflineQueue({ storageKey = 'ki-outbox-v3', max = 500 } = {}) {
  let queue = null; // lazily loaded; the in-memory copy is authoritative once set
  let dropped = 0;
  let persistent = false;

  function storage() {
    try {
      if (typeof window === 'undefined') return null;
      const store = window.localStorage;
      if (!store) return null;
      return store;
    } catch {
      // Accessing localStorage throws outright in some privacy modes.
      return null;
    }
  }

  function load() {
    if (queue) return queue;
    queue = [];
    const store = storage();
    if (!store) return queue;
    persistent = true;
    try {
      const parsed = JSON.parse(store.getItem(storageKey) || 'null');
      if (Array.isArray(parsed)) queue = parsed;
    } catch {
      // A corrupt outbox is discarded rather than wedging every future send.
    }
    return queue;
  }

  function persist() {
    const store = storage();
    if (!store) return;
    try {
      store.setItem(storageKey, JSON.stringify(queue));
    } catch {
      // Quota exceeded or a read-only store: this run keeps working in memory.
      persistent = false;
    }
  }

  const transport = defineTransport({
    name: 'offline',
    rank: RANK.OFFLINE,

    probe: async () => ({ available: true }),

    open: async () => {
      load();
    },

    send: async (sealed) => {
      const q = load();
      q.push(sealed);
      while (q.length > max) {
        q.shift();
        dropped += 1;
      }
      persist();
    },

    // Closing must not discard the queue — that is the whole point of it.
    close: async () => {},

    describe: () => ({ queued: load().length, dropped, max, persistent }),
  });

  /** Take everything queued, in order, and clear it. The caller now owns delivery. */
  transport.drain = () => {
    const q = load();
    if (!q.length) return [];
    queue = [];
    persist();
    return q;
  };

  transport.size = () => load().length;

  /** Oldest queued envelope, or null. Read-only. */
  transport.peek = () => load()[0] ?? null;

  return transport;
}
