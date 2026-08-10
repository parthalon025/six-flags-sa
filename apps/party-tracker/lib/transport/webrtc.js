'use client';

/**
 * WebRTC transport. Star topology, host at the centre.
 *
 * The host holds one RTCPeerConnection per client; a client holds exactly one,
 * to the host. Clients never connect to each other. The host is the only
 * authority on party state, so a mesh would buy nothing but a second path for
 * state to disagree with itself — every frame has to reach the host anyway.
 *
 * Signaling (SDP + ICE) rides the shared mailbox; once the data channel is up
 * the mailbox is idle and the media path is direct phone-to-phone.
 *
 * Two rules keep this transport alive long enough to be useful, and both belong
 * here rather than in the manager:
 *
 *   - A host with no peers is idle, not broken. `send` succeeds when there is
 *     nobody to send to, so the manager leaves this transport selected and its
 *     signaling keeps running. The old behaviour — throw on the first beacon,
 *     fail over, close the signaling — is why no party ever got a direct
 *     channel: after that first PING there was nothing listening for offers.
 *   - A joining client blocks on the direct path for OPEN_TIMEOUT_MS and no
 *     longer. If the channel is not up by then `open` rejects so the join can
 *     proceed over the mailbox, but nothing is torn down: negotiation carries
 *     on, and the channel opening later stamps READY, which is the manager's
 *     cue to move traffic across. `standby` is what tells the manager this
 *     transport is worth keeping open while something else is active.
 */

import { defineTransport, RANK, STATUS } from './types.js';
import { createSignaling } from './signaling.js';
import { newMemberId } from '../core/ids.js';

/**
 * A public STUN server is the default because most parks hand out client-isolated
 * Wi-Fi and cellular NAT. An EMPTY array is a legitimate override, not a mistake:
 * on a shared LAN host candidates alone complete the connection, and that keeps
 * the zero-external-dependency promise intact when there is no internet at all.
 */
const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

const HEALTH_TIMEOUT_MS = 1500;

/**
 * How long a joiner waits on the direct path before the manager is allowed to
 * get on with the join over something else. The product target is a join inside
 * ten seconds; a blocking timeout anywhere near that is a spec violation on its
 * own, and everything this wait buys is still available afterwards.
 */
const OPEN_TIMEOUT_MS = 4000;

/** How long negotiation keeps running in the background after that. */
const NEGOTIATE_TIMEOUT_MS = 3000;

/** Signaling cadence once a client has its channel: renegotiation only. */
const LINKED_POLL_MS = 10000;

const CHANNEL_LABEL = 'party';

export function createWebRTC({ base, role, iceServers } = {}) {
  const root = String(base || '').replace(/\/+$/, '');
  // Array.isArray, not `||`: [] must survive as [].
  const ice = Array.isArray(iceServers) ? iceServers : DEFAULT_ICE;

  /** peerId -> { pc, channel, pending, everOpen } — populated on the host only. */
  const peers = new Map();
  let signaling = null;
  let selfId = null;
  let hostId = null;
  let solo = null; // { pc, channel, pending } — the client's single link
  let isHost = role === 'host';
  /** Callers of `open` waiting on the client's channel. */
  let waiters = [];
  let negotiateTimer = null;

  const post = (to, data) => {
    signaling?.send(to, data).catch(() => {
      /* a lost candidate is survivable; a lost offer surfaces as the open timeout */
    });
  };

  const openChannels = () =>
    isHost
      ? [...peers.values()].filter((p) => p.channel?.readyState === 'open').length
      : Number(solo?.channel?.readyState === 'open');

  function settle(err) {
    for (const w of waiters.splice(0)) {
      clearTimeout(w.timer);
      if (err) w.reject(err);
      else w.resolve();
    }
  }

  const transport = defineTransport({
    name: 'webrtc',
    rank: RANK.WEBRTC,

    async probe() {
      if (typeof RTCPeerConnection === 'undefined') {
        return { available: false, reason: 'unsupported' };
      }
      if (!root) return { available: false, reason: 'no-signaling' };
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), HEALTH_TIMEOUT_MS);
      try {
        const res = await fetch(`${root}/api/health`, { signal: abort.signal, cache: 'no-store' });
        if (!res.ok) return { available: false, reason: 'no-signaling' };
        return { available: true };
      } catch {
        return { available: false, reason: 'no-signaling' };
      } finally {
        clearTimeout(timer);
      }
    },

    async open(ctx, self) {
      const session = ctx?.session || {};
      if (!session.partyId) throw new Error('webrtc: session has no partyId');
      isHost = (ctx?.role || role) === 'host';
      selfId = session.selfId || newMemberId();
      hostId = session.hostId || '*';

      /* ------------------------------------------------------------ wiring -- */

      function wire(entry, id) {
        const channel = entry.channel;
        channel.onmessage = (ev) => {
          let parsed;
          try {
            parsed = JSON.parse(ev.data);
          } catch {
            return; // anything that is not an envelope is not ours
          }
          self.deliver(parsed);
        };
        channel.onclose = () => {
          self.emit('peer', { id, state: 'closed' });
          // A peer that has hung up is not a peer this transport still believes
          // in, so it must stop counting against `send`. The host's remaining
          // channels — or its empty peer set — are the honest picture.
          if (isHost) drop(id);
        };
      }

      function opened(entry, id) {
        entry.everOpen = true;
        self.emit('peer', { id, state: 'connected' });
        // An earlier ICE failure may have left this DEGRADED; a live channel is
        // the manager's cue to move traffic here, and it only reads READY.
        self.setStatus(STATUS.READY);
      }

      function watch(entry, id) {
        const { pc } = entry;
        pc.onconnectionstatechange = () => self.emit('peer', { id, state: pc.connectionState });
        pc.oniceconnectionstatechange = () => {
          const state = pc.iceConnectionState;
          if (state !== 'failed' && state !== 'disconnected') return;
          self.emit('peer', { id, state });
          self.setStatus(STATUS.DEGRADED, `ice ${state} for ${id}`);
          // Tear the peer down rather than nursing a half-dead connection: a
          // client that recovers re-offers through the mailbox and the host
          // accepts it as a new peer, which is the same code path as a join.
          if (isHost) drop(id);
        };
      }

      function drop(id) {
        const entry = peers.get(id);
        if (!entry) return;
        peers.delete(id);
        teardown(entry);
      }

      /* ------------------------------------------------------------- host --- */

      function hostPeer(id) {
        const existing = peers.get(id);
        // A repeat offer from a live peer is a renegotiation; from a dead one it
        // is a reconnect, and the stale RTCPeerConnection has to go first.
        if (existing) {
          const dead = existing.pc.connectionState === 'failed' || existing.pc.connectionState === 'closed';
          if (!dead) return existing;
          drop(id);
        }

        const entry = {
          pc: new RTCPeerConnection({ iceServers: ice }),
          channel: null,
          pending: [],
          everOpen: false,
        };
        peers.set(id, entry);
        entry.pc.onicecandidate = (ev) => {
          if (ev.candidate) post(id, { candidate: ev.candidate.toJSON() });
        };
        entry.pc.ondatachannel = (ev) => {
          entry.channel = ev.channel;
          wire(entry, id);
          if (ev.channel.readyState === 'open') opened(entry, id);
          else ev.channel.onopen = () => opened(entry, id);
        };
        watch(entry, id);
        return entry;
      }

      async function onHostSignal({ from, data }) {
        if (!from || !data) return;
        const entry = data.sdp ? hostPeer(from) : peers.get(from);
        if (!entry) return; // ICE for a peer that never offered
        if (data.sdp) {
          if (data.sdp.type !== 'offer') return; // the host only ever answers
          await entry.pc.setRemoteDescription(data.sdp);
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          post(from, { sdp: { type: answer.type, sdp: answer.sdp } });
          await flush(entry);
        } else if (data.candidate) {
          await accept(entry, data.candidate);
        }
      }

      /* ----------------------------------------------------------- client --- */

      async function onClientSignal({ from, data }) {
        if (!solo || !data) return;
        if (data.sdp) {
          if (data.sdp.type !== 'answer' || solo.pc.signalingState !== 'have-local-offer') return;
          await solo.pc.setRemoteDescription(data.sdp);
          // The invite may not name the host. Whoever answered the offer is it,
          // so later candidates go to a real address instead of the broadcast.
          if (hostId === '*' && from) hostId = from;
          await flush(solo);
        } else if (data.candidate) {
          await accept(solo, data.candidate);
        }
      }

      /** Build the link and put the offer on the wire. Does not wait for it. */
      async function offerToHost() {
        const pc = new RTCPeerConnection({ iceServers: ice });
        solo = {
          pc,
          channel: pc.createDataChannel(CHANNEL_LABEL, { ordered: true }),
          pending: [],
          everOpen: false,
        };
        wire(solo, 'host');
        watch(solo, 'host');
        pc.onicecandidate = (ev) => {
          if (ev.candidate) post(hostId, { candidate: ev.candidate.toJSON() });
        };
        solo.channel.onopen = () => {
          clearTimeout(negotiateTimer);
          negotiateTimer = null;
          // Nothing more is expected on the mailbox until something breaks, so
          // stop paying for it at negotiation speed.
          signaling?.pace(LINKED_POLL_MS);
          opened(solo, hostId);
          settle();
        };

        // Only a give-up deadline. Everything before it is the manager's to
        // schedule around, because negotiation is not blocking anything by then.
        negotiateTimer = setTimeout(() => {
          negotiateTimer = null;
          if (solo?.channel?.readyState === 'open') return;
          const err = new Error('webrtc: no direct channel to the host');
          teardown(solo);
          solo = null;
          // Signaling stays up: the mailbox underneath is often the same one the
          // relay uses, and tearing it down is what made a later joiner wait out
          // a timeout with nobody listening for offers.
          self.setStatus(STATUS.DEGRADED, String(err.message));
          settle(err);
        }, NEGOTIATE_TIMEOUT_MS);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await signaling.send(hostId, { sdp: { type: offer.type, sdp: offer.sdp } });
      }

      /** Resolves when the channel is up, rejects when this caller's patience is. */
      function waitForChannel(ms) {
        if (solo?.channel?.readyState === 'open') return Promise.resolve();
        if (!solo) return Promise.reject(new Error('webrtc: negotiation gave up'));
        return new Promise((resolve, reject) => {
          const w = { resolve, reject, timer: null };
          w.timer = setTimeout(() => {
            waiters = waiters.filter((other) => other !== w);
            // Not a failure: the link is still being negotiated and the manager
            // will be told when it lands. Anything but FAILED keeps it in play.
            self.setStatus(STATUS.DEGRADED, 'negotiating');
            reject(new Error('webrtc: data channel not open yet'));
          }, ms);
          waiters.push(w);
          ctx?.signal?.addEventListener?.('abort', () => settle(new Error('webrtc: aborted')), {
            once: true,
          });
        });
      }

      /* -------------------------------------------------------------------- */

      // A second `open` on a client that is still negotiating must not throw a
      // fresh offer at the host: the one in flight is the one that will land.
      if (!signaling) {
        signaling = createSignaling({ base: root, partyId: session.partyId, selfId });
        const handler = isHost ? onHostSignal : onClientSignal;
        await signaling.start((msg) => {
          Promise.resolve(handler(msg)).catch((err) => {
            self.emit('peer', { id: msg?.from, state: 'error' });
            self.setStatus(STATUS.DEGRADED, String(err?.message || err));
          });
        });
      }

      // The host is usable the moment it can hear offers; it has no peer to wait
      // for. The client is usable only once its channel is actually open.
      if (isHost) return;
      if (!solo) await offerToHost();
      await waitForChannel(OPEN_TIMEOUT_MS);
    },

    async send(sealed) {
      const text = JSON.stringify(sealed);
      if (isHost) {
        let delivered = 0;
        let stranded = false;
        for (const entry of peers.values()) {
          if (entry.channel?.readyState === 'open') {
            entry.channel.send(text);
            delivered += 1;
          } else if (entry.everOpen) {
            stranded = true;
          }
        }
        // A host broadcasting to an empty party has delivered everything it was
        // asked to. Only a peer this host has actually been talking to and can
        // no longer reach is a delivery failure worth failing the transport for.
        if (!delivered && stranded) throw new Error('webrtc: every peer channel is down');
        return;
      }
      if (solo?.channel?.readyState !== 'open') throw new Error('webrtc: channel not open');
      solo.channel.send(text);
    },

    async close() {
      clearTimeout(negotiateTimer);
      negotiateTimer = null;
      settle(new Error('webrtc: closed'));
      for (const entry of peers.values()) teardown(entry);
      peers.clear();
      if (solo) teardown(solo);
      solo = null;
      signaling?.stop();
      signaling = null;
    },

    describe: () => ({
      role: isHost ? 'host' : 'client',
      peers: isHost ? peers.size : Number(Boolean(solo)),
      channels: openChannels(),
      iceServers: ice.length,
    }),
  });

  /**
   * Worth keeping open even when something else is carrying envelopes: the
   * signaling loop underneath this transport is the only way a direct channel
   * ever gets established, so closing it is a decision the party cannot undo.
   */
  transport.standby = true;

  /** Can this transport put a frame in front of a peer right now? */
  transport.carries = () => openChannels() > 0;

  return transport;
}

/* ------------------------------------------------------------- helpers ---- */

/**
 * Candidates routinely arrive before the description they belong to, because
 * the mailbox does not order across senders. Hold them until there is a remote
 * description to attach them to.
 */
async function accept(entry, candidate) {
  if (!entry.pc.remoteDescription) {
    entry.pending.push(candidate);
    return;
  }
  try {
    await entry.pc.addIceCandidate(candidate);
  } catch {
    /* a candidate the stack rejects just means one fewer path to try */
  }
}

async function flush(entry) {
  const queued = entry.pending.splice(0);
  for (const candidate of queued) {
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch {
      /* same as above */
    }
  }
}

function teardown(entry) {
  if (!entry) return;
  try {
    entry.channel?.close();
  } catch {
    /* already closed */
  }
  try {
    entry.pc.close();
  } catch {
    /* already closed */
  }
}
