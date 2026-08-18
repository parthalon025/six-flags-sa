'use client';

/**
 * One mailbox poll loop per party peer.
 *
 * WebRTC signaling and the cloud relay both ride the same `/api/mailbox/{partyId}`
 * endpoint on the same origin. Running two independent poll loops against it
 * doubles the background cost for no gain. This module owns the loop; consumers
 * register handlers by message kind and share hot/cool pacing, SSE, and cursor
 * state until the last one disconnects.
 */

import { markNoStream, mayStream, normalizeBase } from './streamGate.js';

const POLL_HOT_MS = 500;
const HOT_WINDOW_MS = 20000;
const POLL_HIDDEN_MS = 15000;
const DEFAULT_COOL_MS = 2500;

/** @type {Map<string, ReturnType<typeof createPoller>>} */
const instances = new Map();

/**
 * @param {{ base: string, partyId: string, peerId: string }} opts
 */
export function getMailboxPoller({ base, partyId, peerId }) {
  const root = normalizeBase(base);
  if (!root || !partyId || !peerId) throw new Error('mailboxPoller: missing base, partyId or peerId');
  const key = `${root}|${partyId}|${peerId}`;
  let poller = instances.get(key);
  if (!poller) {
    poller = createPoller({ base: root, partyId, peerId, key });
    instances.set(key, poller);
  }
  return poller;
}

function createPoller({ base, partyId, peerId, key }) {
  const box = `${base}/api/mailbox/${encodeURIComponent(partyId)}`;
  const me = encodeURIComponent(peerId);

  let refs = 0;
  /** @type {Map<string, number>} */
  const coolPrefs = new Map();
  let coolMs = DEFAULT_COOL_MS;
  let cursor = 0;
  let seen = -1;
  let lastActivity = 0;
  let stopped = true;
  let timer = null;
  let source = null;
  let streamed = false;
  let mode = 'idle';
  /** @type {Map<string, Set<(msg: object) => void>>} */
  const handlers = new Map();
  /** @type {Set<(mode: string) => void>} */
  const modeListeners = new Set();
  /** @type {Set<(err: Error) => void>} */
  const errorListeners = new Set();
  const watchesVisibility = typeof document !== 'undefined';

  const emitError = (err) => {
    for (const fn of [...errorListeners]) {
      try {
        fn(err);
      } catch {
        /* as above */
      }
    }
  };

  const busy = () => {
    lastActivity = Date.now();
  };

  const recalcCool = () => {
    const values = [...coolPrefs.values()];
    // Max, not min: when WebRTC has linked and signaling paces to 10s, a cloud
    // cool of 2.5s must not keep the shared poller hot. During negotiation both
    // sit near 2–2.5s so max stays in that band.
    coolMs = values.length ? Math.max(...values) : DEFAULT_COOL_MS;
  };

  const delay = () => {
    if (watchesVisibility && document.visibilityState === 'hidden') {
      return Math.max(coolMs, POLL_HIDDEN_MS);
    }
    return Date.now() - lastActivity < HOT_WINDOW_MS ? POLL_HOT_MS : coolMs;
  };

  const setMode = (next) => {
    if (mode === next || stopped) return;
    mode = next;
    for (const fn of [...modeListeners]) {
      try {
        fn(next);
      } catch {
        /* a bad listener must not break delivery */
      }
    }
  };

  const deliverable = (msg) => {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.from === peerId) return false;
    if (msg.to && msg.to !== '*' && msg.to !== peerId) return false;
    return true;
  };

  const route = (msg) => {
    if (!deliverable(msg)) return;
    const seq = Number(msg.seq);
    if (Number.isFinite(seq)) {
      if (seq <= seen) return;
      seen = seq;
      if (seq > cursor) cursor = seq;
    }
    const kind = msg.kind || 'signal';
    // WebRTC negotiation (`signal`) needs a hot poll. Sealed party frames are
    // almost always `envelope`, including host PINGs every 4s — treating those
    // as activity pinned cool cadence at POLL_HOT_MS forever on the cloud
    // relay. Delivery still happens on the next cool tick; send/post and
    // explicit busy() keep the hot window for real back-and-forth.
    if (kind === 'signal') busy();
    const set = handlers.get(kind);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(msg);
        } catch {
          /* a bad handler is not a transport failure */
        }
      }
    }
  };

  async function drain() {
    const res = await fetch(`${box}?for=${me}&since=${cursor}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`mailbox ${res.status}`);
    const body = await res.json();
    for (const msg of body?.messages || []) route(msg);
    const next = Number(body?.cursor);
    if (Number.isFinite(next) && next > cursor) cursor = next;
  }

  function stopPolling() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  async function tick() {
    timer = null;
    if (stopped) return;
    try {
      await drain();
    } catch (err) {
      emitError(err instanceof Error ? err : new Error(String(err)));
      /* the mailbox may be briefly unreachable; the next tick retries */
    }
    if (!stopped && mode === 'polling') timer = setTimeout(tick, delay());
  }

  function startPolling() {
    if (timer || stopped) return;
    setMode('polling');
    timer = setTimeout(tick, delay());
  }

  function closeStream() {
    if (!source) return;
    try {
      source.close();
    } catch {
      /* already torn down */
    }
    source = null;
  }

  function startStream() {
    if (typeof EventSource === 'undefined' || !mayStream(base)) return;
    try {
      source = new EventSource(`${box}/stream?for=${me}`);
    } catch {
      source = null;
      return;
    }
    source.onopen = () => {
      streamed = true;
      stopPolling();
      setMode('stream');
    };
    source.onmessage = (ev) => {
      try {
        route(JSON.parse(ev.data));
      } catch {
        /* a malformed frame is dropped, not fatal */
      }
    };
    source.onerror = () => {
      startPolling();
      if (streamed) return;
      markNoStream(base);
      closeStream();
    };
  }

  function wake() {
    if (stopped || (watchesVisibility && document.hidden) || mode !== 'polling' || !timer) return;
    clearTimeout(timer);
    timer = setTimeout(tick, 0);
  }

  function startDelivery() {
    if (!stopped) return;
    stopped = false;
    busy();
    if (watchesVisibility) document.addEventListener('visibilitychange', wake);
    startPolling();
    startStream();
  }

  function stopDelivery() {
    stopped = true;
    if (watchesVisibility) document.removeEventListener('visibilitychange', wake);
    stopPolling();
    closeStream();
    mode = 'idle';
  }

  function dispose() {
    stopDelivery();
    handlers.clear();
    modeListeners.clear();
    coolPrefs.clear();
    errorListeners.clear();
    instances.delete(key);
  }

  return {
    mode: () => mode,
    cursor: () => cursor,

    retain() {
      refs += 1;
    },

    release() {
      refs = Math.max(0, refs - 1);
      if (refs === 0) dispose();
    },

    /**
     * @param {string} tag
     * @param {number} ms
     */
    setCool(tag, ms) {
      const next = Number(ms);
      if (!Number.isFinite(next) || next <= 0) return;
      coolPrefs.set(tag, next);
      recalcCool();
    },

    clearCool(tag) {
      coolPrefs.delete(tag);
      recalcCool();
    },

    busy,

    onMode(fn) {
      modeListeners.add(fn);
      if (mode !== 'idle') fn(mode);
      return () => modeListeners.delete(fn);
    },

    onError(fn) {
      errorListeners.add(fn);
      return () => errorListeners.delete(fn);
    },

    /**
     * @param {string} kind
     * @param {(msg: object) => void} fn
     */
    subscribe(kind, fn) {
      if (!handlers.has(kind)) handlers.set(kind, new Set());
      handlers.get(kind).add(fn);
    },

    /**
     * @param {string} kind
     * @param {(msg: object) => void} fn
     */
    unsubscribe(kind, fn) {
      handlers.get(kind)?.delete(fn);
    },

    drain,

    startDelivery,

    async post({ to = '*', kind, data }) {
      busy();
      const res = await fetch(box, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: peerId, to, kind, data }),
      });
      if (!res.ok) throw new Error(`mailbox post ${res.status}`);
      return res.json().catch(() => ({ ok: true }));
    },
  };
}
