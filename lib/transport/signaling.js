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

import { getMailboxPoller } from './mailboxPoller.js';

/**
 * Signaling is bursty: nothing for minutes, then an offer, an answer and a
 * dozen candidates inside a second. Polling at one rate serves neither end, and
 * the slow rate is the one a joiner pays for — every extra second here is a
 * second of the join budget spent doing nothing. So the loop runs fast while
 * there is traffic and settles back once there is not.
 */
const POLL_COOL_MS = 2000;

/** Signaling cadence once a client has its channel: renegotiation only. */
const LINKED_POLL_MS = 10000;

const SIGNAL_KIND = 'signal';
const COOL_TAG = 'signaling';

export function createSignaling({ base, partyId, selfId }) {
  const poller = getMailboxPoller({ base, partyId, peerId: selfId });

  let onSignal = null;
  let started = false;

  /** A listener that throws must never break the signaling loop. */
  function hand(msg) {
    if (msg.kind && msg.kind !== SIGNAL_KIND) return;
    try {
      onSignal?.({ from: msg.from, data: msg.data });
    } catch {
      /* a bad handler is not a transport failure */
    }
  }

  return {
    async start(handler) {
      onSignal = handler;
      poller.setCool(COOL_TAG, POLL_COOL_MS);
      poller.subscribe(SIGNAL_KIND, hand);
      if (!started) {
        poller.retain();
        started = true;
      }
      poller.busy();
      // Drain once before subscribing: the stream only carries what arrives
      // after it opens, and an offer posted a moment earlier is already sitting
      // in the mailbox. The shared poller's `seen` then suppresses repeats.
      try {
        await poller.drain();
      } catch {
        /* the first poll tick will retry */
      }
      if (!onSignal) return;
      poller.startDelivery();
    },

    async send(to, data) {
      // Whatever we just posted has an answer coming, so this counts as traffic
      // even though nothing has arrived yet.
      return poller.post({ to, kind: SIGNAL_KIND, data });
    },

    /**
     * Set the idle cadence. A client with a live data channel needs this loop
     * only for renegotiation, and paying two requests a second for that is the
     * kind of background cost a phone in a park notices.
     */
    pace(ms) {
      poller.setCool(COOL_TAG, ms);
    },

    stop() {
      onSignal = null;
      if (!started) return;
      poller.unsubscribe(SIGNAL_KIND, hand);
      poller.clearCool(COOL_TAG);
      poller.release();
      started = false;
    },
  };
}
