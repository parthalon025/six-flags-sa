'use client';

/**
 * WebRTC signaling over the shared mailbox endpoint.
 *
 * The mailbox is a dumb store-and-forward queue — it does not know what a
 * session description is, only that peer A left an opaque blob addressed to
 * peer B. That keeps signaling on the same endpoint the other transports
 * already need, so there is no second server to run.
 *
 * Wire contract (canonical):
 *   POST {base}/api/mailbox/{partyId}                       -> { ok, seq }
 *   GET  {base}/api/mailbox/{partyId}?for={id}&since={cur}  -> { messages, cursor }
 *   GET  {base}/api/mailbox/{partyId}/stream?for={id}       -> SSE, one msg per line
 */

import { markNoStream, mayStream } from './mailboxClient.js';

/**
 * Signaling is bursty: nothing for minutes, then an offer, an answer and a
 * dozen candidates inside a second. Polling at one rate serves neither end, and
 * the slow rate is the one a joiner pays for — every extra second here is a
 * second of the join budget spent doing nothing. So the loop runs fast while
 * there is traffic and settles back once there is not.
 */
const POLL_HOT_MS = 500;
const POLL_COOL_MS = 2000;
const HOT_WINDOW_MS = 20000;

const SIGNAL_KIND = 'signal';

export function createSignaling({ base, partyId, selfId }) {
  const root = String(base || '').replace(/\/+$/, '');
  const box = `${root}/api/mailbox/${encodeURIComponent(partyId)}`;
  const me = encodeURIComponent(selfId);

  let onSignal = null;
  let stopped = true;
  let cursor = 0;
  let seen = -1; // highest seq handed to the callback, across both delivery paths
  let source = null;
  let timer = null;
  let cool = POLL_COOL_MS;
  let lastActivity = 0;

  const busy = () => {
    lastActivity = Date.now();
  };

  const delay = () => (Date.now() - lastActivity < HOT_WINDOW_MS ? POLL_HOT_MS : cool);

  /** A listener that throws must never break the signaling loop. */
  function hand(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind && msg.kind !== SIGNAL_KIND) return;
    if (msg.from === selfId) return;
    if (Number.isFinite(msg.seq)) {
      if (msg.seq <= seen) return;
      seen = msg.seq;
    }
    busy();
    try {
      onSignal?.({ from: msg.from, data: msg.data });
    } catch {
      /* a bad handler is not a transport failure */
    }
  }

  async function drain() {
    const res = await fetch(`${box}?for=${me}&since=${cursor}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`mailbox ${res.status}`);
    const body = await res.json();
    if (Array.isArray(body?.messages)) for (const m of body.messages) hand(m);
    if (Number.isFinite(body?.cursor)) cursor = body.cursor;
  }

  function poll() {
    if (stopped || timer) return;
    const tick = async () => {
      if (stopped) return;
      try {
        await drain();
      } catch {
        /* the mailbox may be briefly unreachable; the next tick retries */
      }
      if (!stopped) timer = setTimeout(tick, delay());
    };
    timer = setTimeout(tick, delay());
  }

  function stream() {
    // A base with no SSE is known before the first request, not discovered by
    // failing one: see mailboxClient. Polling is the contract everywhere.
    if (typeof EventSource === 'undefined' || !mayStream(root)) {
      poll();
      return;
    }
    try {
      source = new EventSource(`${box}/stream?for=${me}`);
    } catch {
      poll();
      return;
    }
    source.onmessage = (ev) => {
      try {
        hand(JSON.parse(ev.data));
      } catch {
        /* a malformed frame is dropped, not fatal */
      }
    };
    // EventSource retries on its own, but a stream that is not there retries
    // forever without ever delivering. Polling always works, so one error is
    // enough to give up on the stream and to remember that this base has none.
    source.onerror = () => {
      if (stopped) return;
      markNoStream(root);
      close();
      poll();
    };
  }

  function close() {
    if (source) {
      try {
        source.close();
      } catch {
        /* already torn down */
      }
      source = null;
    }
  }

  return {
    async start(handler) {
      onSignal = handler;
      stopped = false;
      busy();
      // Drain once before subscribing: the stream only carries what arrives
      // after it opens, and an offer posted a moment earlier is already sitting
      // in the mailbox. `seen` then suppresses anything the stream repeats.
      try {
        await drain();
      } catch {
        /* the first poll tick will retry */
      }
      if (stopped) return;
      stream();
    },

    async send(to, data) {
      // Whatever we just posted has an answer coming, so this counts as traffic
      // even though nothing has arrived yet.
      busy();
      const res = await fetch(box, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: selfId, to, kind: SIGNAL_KIND, data }),
      });
      if (!res.ok) throw new Error(`mailbox post ${res.status}`);
      return res.json().catch(() => ({ ok: true }));
    },

    /**
     * Set the idle cadence. A client with a live data channel needs this loop
     * only for renegotiation, and paying two requests a second for that is the
     * kind of background cost a phone in a park notices.
     */
    pace(ms) {
      const next = Number(ms);
      if (Number.isFinite(next) && next > 0) cool = next;
    },

    stop() {
      stopped = true;
      onSignal = null;
      close();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
