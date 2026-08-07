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

const POLL_MS = 2000;
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

  /** A listener that throws must never break the signaling loop. */
  function hand(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind && msg.kind !== SIGNAL_KIND) return;
    if (msg.from === selfId) return;
    if (Number.isFinite(msg.seq)) {
      if (msg.seq <= seen) return;
      seen = msg.seq;
    }
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
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
  }

  function stream() {
    if (typeof EventSource === 'undefined') {
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
    // EventSource retries on its own, but a 404 or a proxy that buffers SSE
    // retries forever without ever delivering. Polling always works, so one
    // error is enough to give up on the stream for this session.
    source.onerror = () => {
      if (stopped) return;
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
      const res = await fetch(box, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: selfId, to, kind: SIGNAL_KIND, data }),
      });
      if (!res.ok) throw new Error(`mailbox post ${res.status}`);
      return res.json().catch(() => ({ ok: true }));
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
