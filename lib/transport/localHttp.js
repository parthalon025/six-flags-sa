'use client';

/**
 * The LAN / self-hosted mailbox: the standalone Node host in /server, reached
 * over the local network or a phone hotspot.
 *
 * Same wire protocol as the cloud relay, so all of it is the shared mailbox
 * client. What differs is the probe: this address is usually a guess (a saved
 * hotspot IP, a hostname from a QR code) and a wrong guess on a LAN does not
 * refuse the connection, it black-holes it. An unbounded probe would stall the
 * whole selection pass behind one dead host, so this one is hard-capped.
 */

import { defineTransport, RANK } from './types.js';
import { applyMailboxMode, createMailboxChannel, probeMailboxHealth } from './mailboxClient.js';

/** Long enough for a sleepy laptop on Wi-Fi, short enough not to stall startup. */
export const LOCAL_PROBE_TIMEOUT_MS = 1200;

/** The host is a few metres away; a tighter poll costs nothing worth counting. */
const LOCAL_POLL_MS = 2000;

export function createLocalHttp({ base } = {}) {
  let channel = null;

  return defineTransport({
    name: 'local-http',
    rank: RANK.LOCAL_HTTP,

    probe: () => probeMailboxHealth(base, { timeoutMs: LOCAL_PROBE_TIMEOUT_MS }),

    open: async (ctx, self) => {
      const session = ctx?.session;
      channel = createMailboxChannel({
        base,
        partyId: session?.partyId,
        peerId: session?.selfId,
        pollMs: LOCAL_POLL_MS,
        onEnvelope: (data) => self.deliver(data),
        onSignal: (msg) => self.emit('signal', msg),
        onMode: (mode) => applyMailboxMode(self, mode),
        onError: (err) => {
          ctx?.log?.('local-http poll failed', err);
          self.fail(err);
        },
      });
      await channel.start();
      // See cloudRelay: READY is stamped after open resolves, so the polling
      // fallback has to correct the status once that stamp has landed.
      setTimeout(() => channel && applyMailboxMode(self, channel.mode()), 0);
    },

    send: async (sealed) => {
      if (!channel) throw new Error('local-http is not open');
      await channel.send(sealed);
    },

    close: async () => {
      channel?.stop();
      channel = null;
    },

    describe: () => ({ base: base || null, mode: channel?.mode() || 'idle', cursor: channel?.cursor() ?? 0 }),
  });
}
