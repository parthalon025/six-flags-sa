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

export const DEFAULT_POLL_MS = 5000;

/** Errors on the stream before we stop trusting it and stay on polling. */
const STREAM_ERROR_BUDGET = 3;

export const normalizeBase = (base) => String(base || '').replace(/\/+$/, '');

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
  let streamErrors = 0;
  let mode = 'idle';
  let stopped = false;

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
    timer = setInterval(() => {
      poll().catch((err) => onError?.(err));
    }, pollMs);
  }

  function stopPolling() {
    if (!timer) return;
    clearInterval(timer);
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
    if (!allowStream || typeof EventSource === 'undefined') return;
    try {
      source = new EventSource(`${box}/stream?for=${encodeURIComponent(peerId)}`);
    } catch {
      source = null;
      return;
    }
    source.onopen = () => {
      streamErrors = 0;
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
      // EventSource reconnects on its own, but we cannot sit blind while it
      // does: resume polling now and let onopen take back over if it recovers.
      startPolling();
      streamErrors += 1;
      if (streamErrors >= STREAM_ERROR_BUDGET) closeStream();
    };
  }

  return {
    mode: () => mode,
    cursor: () => cursor,

    /** Resolves once the mailbox has actually answered. Rejects if it has not. */
    async start() {
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
