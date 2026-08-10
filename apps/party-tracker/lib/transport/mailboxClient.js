'use client';

/**
 * The HTTP mailbox client, shared by every transport that speaks it.
 *
 * A mailbox is a dumb store-and-forward queue: it moves opaque blobs between
 * peers of a party and can read none of them. The shared poll loop lives in
 * mailboxPoller.js; this module supplies probe helpers and the channel wrapper
 * the relay transports build on.
 *
 *   POST {base}/api/mailbox/{partyId}            { from, to, kind, data } -> { ok, seq }
 *   GET  {base}/api/mailbox/{partyId}?for&since  -> { messages: [...], cursor }
 *   GET  {base}/api/mailbox/{partyId}/stream?for -> SSE, one message per data: line
 */

import { STATUS } from './types.js';
import { getMailboxPoller } from './mailboxPoller.js';

/**
 * Cool cadence for the cloud relay. It is the fallback path, so every poll here
 * is latency a joiner may be waiting on; the hot window below covers the burst
 * that a join actually is, and this number covers the hours of nothing after.
 */
export const DEFAULT_POLL_MS = 2500;

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

  const poller = getMailboxPoller({ base: root, partyId, peerId });
  const COOL_TAG = 'mailbox-channel';
  let offMode = null;
  let offError = null;
  let started = false;

  function onEnvelopeMsg(msg) {
    onEnvelope?.(msg.data);
  }

  function onOtherMsg(msg) {
    onSignal?.(msg);
  }

  return {
    mode: () => poller.mode(),
    cursor: () => poller.cursor(),

    /** Resolves once the mailbox has actually answered. Rejects if it has not. */
    async start() {
      poller.setCool(COOL_TAG, pollMs);
      poller.subscribe('envelope', onEnvelopeMsg);
      poller.subscribe('signal', onOtherMsg);
      if (!started) {
        poller.retain();
        started = true;
      }
      poller.busy();
      try {
        await poller.drain();
      } catch (err) {
        onError?.(err);
        throw err;
      }
      if (!started) return;
      offMode = poller.onMode((next) => onMode?.(next));
      if (onError) offError = poller.onError(onError);
      poller.startDelivery();
      if (!allowStream && poller.mode() === 'stream') {
        // A consumer that opts out of SSE still shares the poller; polling is
        // already running underneath when the stream is absent.
        onMode?.('polling');
      }
    },

    async post({ to = '*', kind, data }) {
      return poller.post({ to, kind, data });
    },

    send(sealed) {
      return this.post({ to: '*', kind: 'envelope', data: sealed });
    },

    stop() {
      if (!started) return;
      offMode?.();
      offMode = null;
      offError?.();
      offError = null;
      poller.unsubscribe('envelope', onEnvelopeMsg);
      poller.unsubscribe('signal', onOtherMsg);
      poller.clearCool(COOL_TAG);
      poller.release();
      started = false;
      onMode?.('idle');
    },
  };
}
