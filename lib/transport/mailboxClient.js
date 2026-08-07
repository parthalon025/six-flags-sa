'use client';

/**
 * The HTTP mailbox client, shared by every transport that speaks it.
 *
 * A mailbox is a dumb store-and-forward queue: it moves opaque blobs between
 * peers of a party and can read none of them. Two transports ride the exact
 * same endpoints — the LAN/self-hosted Node host and the cloud relay — so the
 * polling/SSE machinery lives here once and they differ only in base URL,
 * probe budget and poll interval.
 *
 *   POST {base}/api/mailbox/{partyId}            { from, to, kind, data } -> { ok, seq }
 *   GET  {base}/api/mailbox/{partyId}?for&since  -> { messages: [...], cursor }
 *   GET  {base}/api/mailbox/{partyId}/stream?for -> SSE, one message per data: line
 */

import { STATUS } from './types.js';

/**
 * Cool cadence for the cloud relay. It is the fallback path, so every poll here
 * is latency a joiner may be waiting on; the hot window below covers the burst
 * that a join actually is, and this number covers the hours of nothing after.
 */
export const DEFAULT_POLL_MS = 2500;

/** Poll cadence while the mailbox is actively carrying a conversation. */
const POLL_HOT_MS = 700;
const HOT_WINDOW_MS = 12000;

export const normalizeBase = (base) => String(base || '').replace(/\/+$/, '');

/**
 * Bases known to have no `/stream`. One page, one answer, no retries.
 *
 * The relay in app/api deliberately implements no SSE — serverless gives no
 * useful guarantee about how long a response may stay open — while the
 * standalone Node host in /server does. Asking anyway costs a 404 per peer per
 * page load, which is real console noise for a fact that is knowable up front:
 * a base that is this app's own origin IS that relay. Anything else is asked
 * once, and a stream that never opens is remembered here as absent.
 */
const noStream = new Set();

const ownOrigin = () => (typeof window === 'undefined' ? '' : normalizeBase(window.location.origin));

/** True if `base` is worth attempting an EventSource against. */
export function mayStream(base) {
  const root = normalizeBase(base);
  if (noStream.has(root)) return false;
  // An empty base is a relative URL, which is this app's own origin too.
  return Boolean(root) && root !== ownOrigin();
}

/** Remember that `base` serves no stream. Permanent for this page. */
export function markNoStream(base) {
  noStream.add(normalizeBase(base));
}

/**
 * Liveness check. `timeoutMs` above zero arms an AbortController, which is what
 * keeps a LAN probe from hanging for the OS connect timeout on an address that
 * is routable but dead.
 */
export async function probeMailboxHealth(base, { timeoutMs = 0 } = {}) {
  const root = normalizeBase(base);
  if (!root) return { available: false, reason: 'no-base' };

  const controller = timeoutMs > 0 && typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const url = `${root}/api/health`;
  const opts = { cache: 'no-store', signal: controller?.signal };

  try {
    let res = await fetch(url, { method: 'HEAD', ...opts });
    // Plenty of hosts and edge proxies answer HEAD with 405/501 while GET works.
    if (res.status === 405 || res.status === 501) res = await fetch(url, { method: 'GET', ...opts });
    return res.ok ? { available: true } : { available: false, reason: `health ${res.status}` };
  } catch (err) {
    if (err?.name === 'AbortError') return { available: false, reason: 'unreachable' };
    return { available: false, reason: String(err?.message || err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Stamp a transport's status from the channel's delivery mode. Polling is a
 * working-but-worse state, not a healthy one, so it reports DEGRADED and the
 * diagnostics panel can say why the roster feels laggy.
 */
export function applyMailboxMode(self, mode) {
  if (self.status === STATUS.CLOSED || self.status === STATUS.FAILED) return;
  if (mode === 'stream') self.setStatus(STATUS.READY);
  else if (mode === 'polling') self.setStatus(STATUS.DEGRADED, 'polling');
}

/**
 * One channel per open transport.
 *
 * `start()` resolves only once the mailbox has answered a real GET, so a
 * transport built on this can honour "open resolves only when usable". Polling
 * starts immediately and the stream, if it opens, supersedes it — that ordering
 * means there is never a window where nothing is listening.
 */
export function createMailboxChannel({
  base,
  partyId,
  peerId,
  pollMs = DEFAULT_POLL_MS,
  allowStream = true,
  onEnvelope,
  onSignal,
  onMode,
  onError,
}) {
  const root = normalizeBase(base);
  if (!root) throw new Error('mailbox: missing base');
  if (!partyId) throw new Error('mailbox: missing partyId');
  if (!peerId) throw new Error('mailbox: missing peerId');

  const box = `${root}/api/mailbox/${encodeURIComponent(partyId)}`;
  let cursor = 0;
  let timer = null;
  let source = null;
  let streamed = false; // the stream opened at least once, so it does exist
  let mode = 'idle';
  let stopped = false;
  let lastTraffic = 0;

  /**
   * Fast while the party is talking, cheap when it is not. Only inbound traffic
   * counts: a host beacon every few seconds is our own noise, and letting it
   * hold the loop open would mean an idle party polls at the fast rate forever.
   */
  const delay = () => (Date.now() - lastTraffic < HOT_WINDOW_MS ? Math.min(POLL_HOT_MS, pollMs) : pollMs);

  function setMode(next) {
    if (mode === next || stopped) return;
    mode = next;
    onMode?.(next);
  }

  function route(msg) {
    if (stopped || !msg || typeof msg !== 'object') return;
    // The same message can arrive on the stream and on an in-flight poll during
    // the handover; seq is monotonic per mailbox, so one comparison covers it.
    const seq = Number(msg.seq);
    if (Number.isFinite(seq)) {
      if (seq <= cursor) return;
      cursor = seq;
    }
    if (msg.from === peerId) return; // our own broadcast coming back around
    if (msg.to && msg.to !== '*' && msg.to !== peerId) return;

    lastTraffic = Date.now();
    if (msg.kind === 'envelope') onEnvelope?.(msg.data);
    else onSignal?.(msg);
  }

  async function poll() {
    const url = `${box}?for=${encodeURIComponent(peerId)}&since=${encodeURIComponent(cursor)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`mailbox ${res.status}`);
    const body = await res.json();
    for (const msg of body?.messages || []) route(msg);
    // The server is the authority on where we are in the log; trusting its
    // cursor is what makes an empty poll still advance past expired messages.
    const next = Number(body?.cursor);
    if (Number.isFinite(next) && next > cursor) cursor = next;
  }

  function startPolling() {
    if (timer || stopped) return;
    setMode('polling');
    const tick = async () => {
      timer = null;
      if (stopped) return;
      try {
        await poll();
      } catch (err) {
        onError?.(err);
      }
      if (!stopped && mode === 'polling') timer = setTimeout(tick, delay());
    };
    timer = setTimeout(tick, delay());
  }

  function stopPolling() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function closeStream() {
    if (!source) return;
    try {
      source.close();
    } catch {
      /* already gone */
    }
    source = null;
  }

  function startStream() {
    if (!allowStream || typeof EventSource === 'undefined' || !mayStream(root)) return;
    try {
      source = new EventSource(`${box}/stream?for=${encodeURIComponent(peerId)}`);
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
        /* a malformed frame is dropped, not fatal to the stream */
      }
    };
    source.onerror = () => {
      // We cannot sit blind while EventSource retries: resume polling now. If
      // the stream never opened at all there is nothing to retry — this base
      // has no SSE, and remembering that is what stops the next peer asking.
      startPolling();
      if (streamed) return;
      markNoStream(root);
      closeStream();
    };
  }

  return {
    mode: () => mode,
    cursor: () => cursor,

    /** Resolves once the mailbox has actually answered. Rejects if it has not. */
    async start() {
      lastTraffic = Date.now(); // a channel that just opened is expecting company
      await poll();
      if (stopped) return;
      startPolling();
      startStream();
    },

    async post({ to = '*', kind, data }) {
      const res = await fetch(box, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: peerId, to, kind, data }),
      });
      if (!res.ok) throw new Error(`mailbox ${res.status}`);
      return res.json().catch(() => ({ ok: true }));
    },

    send(sealed) {
      return this.post({ to: '*', kind: 'envelope', data: sealed });
    },

    stop() {
      stopped = true;
      stopPolling();
      closeStream();
      mode = 'idle';
    },
  };
}
