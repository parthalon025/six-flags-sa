'use client';

/**
 * The cloud relay: a mailbox on the public internet.
 *
 * Ranked last of the real transports because it is the only one that leaves the
 * park's network, but it is also the only one that works when two phones are on
 * different carriers. It sees `pid` and ciphertext and nothing else.
 */

import { defineTransport, RANK } from './types.js';
import { applyMailboxMode, createMailboxChannel, probeMailboxHealth, DEFAULT_POLL_MS } from './mailboxClient.js';

export function createCloudRelay({ base } = {}) {
  let channel = null;

  const transport = defineTransport({
    name: 'cloud-relay',
    rank: RANK.CLOUD_RELAY,

    probe: () => probeMailboxHealth(base),

    open: async (ctx, self) => {
      const session = ctx?.session;
      channel = createMailboxChannel({
        base,
        partyId: session?.partyId,
        peerId: session?.selfId,
        pollMs: DEFAULT_POLL_MS,
        onEnvelope: (data) => self.deliver(data),
        onSignal: (msg) => self.emit('signal', msg),
        onMode: (mode) => applyMailboxMode(self, mode),
        onError: (err) => {
          ctx?.log?.('cloud-relay poll failed', err);
          self.fail(err);
        },
      });
      await channel.start();
      // defineTransport stamps READY the moment this resolves, so the real mode
      // has to be re-applied on the next tick or a polling fallback would be
      // reported as a healthy push connection.
      setTimeout(() => channel && applyMailboxMode(self, channel.mode()), 0);
    },

    send: async (sealed) => {
      if (!channel) throw new Error('cloud-relay is not open');
      await channel.send(sealed);
    },

    close: async () => {
      channel?.stop();
      channel = null;
    },

    describe: () => ({ base: base || null, mode: channel?.mode() || 'idle', cursor: channel?.cursor() ?? 0 }),
  });

  return transport;
}
