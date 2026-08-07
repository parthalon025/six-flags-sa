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
const OPEN_TIMEOUT_MS = 12000;
const CHANNEL_LABEL = 'party';

export function createWebRTC({ base, role, iceServers } = {}) {
  const root = String(base || '').replace(/\/+$/, '');
  // Array.isArray, not `||`: [] must survive as [].
  const ice = Array.isArray(iceServers) ? iceServers : DEFAULT_ICE;

  /** peerId -> { pc, channel, pending } — populated on the host only. */
  const peers = new Map();
  let signaling = null;
  let selfId = null;
  let hostId = null;
  let solo = null; // { pc, channel, pending } — the client's single link
  let isHost = role === 'host';

  const post = (to, data) => {
    signaling?.send(to, data).catch(() => {
      /* a lost candidate is survivable; a lost offer surfaces as the open timeout */
    });
  };

  return defineTransport({
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

      signaling = createSignaling({ base: root, partyId: session.partyId, selfId });

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
        channel.onclose = () => self.emit('peer', { id, state: 'closed' });
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

        const entry = { pc: new RTCPeerConnection({ iceServers: ice }), channel: null, pending: [] };
        peers.set(id, entry);
        entry.pc.onicecandidate = (ev) => {
          if (ev.candidate) post(id, { candidate: ev.candidate.toJSON() });
        };
        entry.pc.ondatachannel = (ev) => {
          entry.channel = ev.channel;
          wire(entry, id);
          if (ev.channel.readyState === 'open') self.emit('peer', { id, state: 'connected' });
          else ev.channel.onopen = () => self.emit('peer', { id, state: 'connected' });
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

      async function connectToHost() {
        const pc = new RTCPeerConnection({ iceServers: ice });
        solo = { pc, channel: pc.createDataChannel(CHANNEL_LABEL, { ordered: true }), pending: [] };
        wire(solo, 'host');
        watch(solo, 'host');
        pc.onicecandidate = (ev) => {
          if (ev.candidate) post(hostId, { candidate: ev.candidate.toJSON() });
        };

        const ready = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('webrtc: data channel did not open in time'));
          }, OPEN_TIMEOUT_MS);
          const settle = (err) => {
            clearTimeout(timer);
            if (err) reject(err);
            else resolve();
          };
          solo.channel.onopen = () => {
            self.emit('peer', { id: hostId, state: 'connected' });
            settle();
          };
          solo.channel.onerror = () => settle(new Error('webrtc: data channel error'));
          ctx?.signal?.addEventListener?.('abort', () => settle(new Error('webrtc: aborted')), {
            once: true,
          });
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await signaling.send(hostId, { sdp: { type: offer.type, sdp: offer.sdp } });

        try {
          await ready;
        } catch (err) {
          // Leave nothing half-open behind: the manager is about to try the
          // next transport and this one must not keep retrying underneath it.
          teardown(solo);
          solo = null;
          signaling.stop();
          signaling = null;
          throw err;
        }
      }

      /* -------------------------------------------------------------------- */

      const handler = isHost ? onHostSignal : onClientSignal;
      await signaling.start((msg) => {
        Promise.resolve(handler(msg)).catch((err) => {
          self.emit('peer', { id: msg?.from, state: 'error' });
          self.setStatus(STATUS.DEGRADED, String(err?.message || err));
        });
      });

      // The host is usable the moment it can hear offers; it has no peer to wait
      // for. The client is usable only once its channel is actually open.
      if (!isHost) await connectToHost();
    },

    async send(sealed) {
      const text = JSON.stringify(sealed);
      if (isHost) {
        let delivered = 0;
        for (const entry of peers.values()) {
          if (entry.channel?.readyState !== 'open') continue;
          entry.channel.send(text);
          delivered += 1;
        }
        // Throwing is the signal the manager watches for: no open channel means
        // this transport is carrying nothing and something else must take over.
        if (!delivered) throw new Error('webrtc: no open data channel');
        return;
      }
      if (solo?.channel?.readyState !== 'open') throw new Error('webrtc: channel not open');
      solo.channel.send(text);
    },

    async close() {
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
      channels: isHost
        ? [...peers.values()].filter((p) => p.channel?.readyState === 'open').length
        : Number(solo?.channel?.readyState === 'open'),
      iceServers: ice.length,
    }),
  });
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
