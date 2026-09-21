/**
 * Minimal in-process RTCPeerConnection for mailbox-signaled WebRTC tests.
 */

/** @type {{ partyId: string, peerId: string, role: 'host' | 'client' } | null} */
let context = null;

/** @type {Map<string, { openDelayMs: number, byPeer: Map<string, { channel?: MockDataChannel }> }>} */
const hubs = new Map();

function hub(partyId) {
  let h = hubs.get(partyId);
  if (!h) {
    h = { openDelayMs: 0, byPeer: new Map() };
    hubs.set(partyId, h);
  }
  return h;
}

/**
 * @param {{ partyId: string, peerId: string, role: 'host' | 'client' }} ctx
 */
export function setRtcContext(ctx) {
  context = ctx;
}

export function setRtcOpenDelay(partyId, ms) {
  hub(partyId).openDelayMs = ms;
}

export function resetRtcHub(partyId) {
  hubs.delete(partyId);
}

function pairChannels(a, b) {
  a._peer = b;
  b._peer = a;
}

class MockDataChannel {
  constructor(label) {
    this.label = label;
    this.readyState = 'connecting';
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this._peer = null;
    this._timer = null;
  }

  send(data) {
    if (this.readyState !== 'open') throw new Error('mock channel not open');
    this._peer?.onmessage?.({ data });
  }

  close() {
    this.readyState = 'closed';
    if (this._timer) clearTimeout(this._timer);
  }

  _scheduleOpen(ms) {
    if (this._timer) clearTimeout(this._timer);
    if (ms <= 0) {
      if (this.readyState === 'closed') return;
      this.readyState = 'open';
      this.onopen?.();
      return;
    }
    this._timer = setTimeout(() => {
      if (this.readyState === 'closed') return;
      this.readyState = 'open';
      this.onopen?.();
    }, ms);
  }
}

class MockPeerConnection {
  constructor({ partyId, peerId, role }) {
    this.partyId = partyId;
    const existing = hub(partyId).byPeer.get(peerId);
    if (existing?.channel) {
      // Host answers while setRtcContext still names the joiner.
      this.peerId = `host-for-${peerId}`;
      this.role = 'host';
    } else {
      this.peerId = peerId;
      this.role = role;
    }
    this.signalingState = 'stable';
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.onicecandidate = null;
    this.ondatachannel = null;
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    this.localDescription = null;
    this.remoteDescription = null;
    this._channel = null;
    hub(partyId).byPeer.set(this.peerId, { pc: this });
  }

  createDataChannel(label) {
    const channel = new MockDataChannel(label);
    this._channel = channel;
    const entry = hub(this.partyId).byPeer.get(this.peerId);
    if (entry) entry.channel = channel;
    return channel;
  }

  async createOffer() {
    return { type: 'offer', sdp: `mock-offer:${this.peerId}` };
  }

  async createAnswer() {
    return { type: 'answer', sdp: `mock-answer:${this.peerId}` };
  }

  _emitIce() {
    const candidate = {
      candidate: 'mock',
      sdpMid: '0',
      sdpMLineIndex: 0,
      toJSON() {
        return { candidate: 'mock', sdpMid: '0', sdpMLineIndex: 0 };
      },
    };
    this.onicecandidate?.({ candidate });
    this.onicecandidate?.({ candidate: null });
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
    if (desc.type === 'offer') this.signalingState = 'have-local-offer';
    if (desc.type === 'answer') this.signalingState = 'stable';
    this._emitIce();
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    if (desc.type === 'offer') {
      // The joiner overwrites setRtcContext before the host's mailbox poll runs.
      this.role = 'host';
      this.signalingState = 'have-remote-offer';
      const offerer = desc.sdp?.match(/mock-offer:(.+)$/)?.[1];
      this._linkAsHost(offerer);
    }
    if (desc.type === 'answer') {
      this.signalingState = 'stable';
    }
  }

  async addIceCandidate() {}

  close() {
    this.connectionState = 'closed';
    this._channel?.close();
  }

  _linkAsHost(offererId) {
    if (!offererId || this.role !== 'host') return;
    const h = hub(this.partyId);
    const clientChannel = h.byPeer.get(offererId)?.channel;
    if (!clientChannel || clientChannel._peer) return;

    const hostChannel = new MockDataChannel('party');
    pairChannels(clientChannel, hostChannel);
    this.ondatachannel?.({ channel: hostChannel });
    const delay = h.openDelayMs;
    clientChannel._scheduleOpen(delay);
    hostChannel._scheduleOpen(delay);
    this.connectionState = 'connected';
    this.iceConnectionState = 'connected';
  }
}

/**
 * @returns {{ restore: () => void }}
 */
export function installMockRtc() {
  const prior = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = class {
    constructor(config) {
      if (!context) throw new Error('mockRtc: call setRtcContext before new RTCPeerConnection');
      return new MockPeerConnection({ ...context, iceServers: config?.iceServers });
    }
  };
  return {
    restore: () => {
      globalThis.RTCPeerConnection = prior;
      context = null;
    },
  };
}
