#!/usr/bin/env node
/**
 * Issue #309 — WebRTC over QR signaling with mailbox blocked.
 *
 * Seams: createWebRTC({ signal: 'qr' }) and encodeOffer/decodeAnswer handoff.
 */

import assert from 'node:assert/strict';

const APP = '../../apps/party-tracker/';
const { createWebRTC } = await import(`${APP}lib/transport/webrtc.js`);
const { createQrExchange } = await import(`${APP}lib/transport/qrExchange.js`);
const { encodeOffer, decodeOffer, encodeAnswer, decodeAnswer } = await import(
  `${APP}lib/transport/qrSignal.js`,
);
const { STATUS } = await import(`${APP}lib/transport/types.js`);
const { PING } = await import(`${APP}lib/core/protocol.js`);
const { installBrowserGlobals } = await import('./lib/mockMailbox.mjs');
const { installMockRtc, setRtcContext, resetRtcHub } = await import('./lib/mockRtc.mjs');

const PASS = [];
const FAIL = [];
const check = async (name, fn) => {
  try {
    await fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

const REAL_SET_TIMEOUT = globalThis.setTimeout;
const settle = async (turns = 8) => {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => REAL_SET_TIMEOUT(r, 0));
};

const partyId = () => `p-${Math.random().toString(16).slice(2, 10)}`;

/** Block every mailbox route — QR mode must not touch the relay. */
function blockMailbox() {
  const prior = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes('/api/mailbox/')) {
      throw new Error(`mailbox blocked: ${target}`);
    }
    if (prior) return prior(url, init);
    throw new Error(`fetch blocked: ${target}`);
  };
  return {
    restore: () => {
      globalThis.fetch = prior;
    },
  };
}

/** Wire offer/answer between host and client QR hooks. */
function wireQrExchange() {
  const exchange = createQrExchange();
  return { hostQr: exchange.host, clientQr: exchange.client };
}

console.log('webrtc over QR (#309)');

await check('host and client open a data channel with mailbox routes blocked', async () => {
  const id = partyId();
  const hostId = 'm-host';
  const clientId = 'm-client';
  const browser = installBrowserGlobals();
  const blocked = blockMailbox();
  const rtc = installMockRtc();
  const { hostQr, clientQr } = wireQrExchange();

  setRtcContext({ partyId: id, peerId: hostId, role: 'host' });
  const host = createWebRTC({ signal: 'qr', qr: hostQr, role: 'host', iceServers: [] });
  const hostMsgs = [];
  host.on('message', (m) => hostMsgs.push(m));

  setRtcContext({ partyId: id, peerId: clientId, role: 'client' });
  const client = createWebRTC({ signal: 'qr', qr: clientQr, role: 'client', iceServers: [] });
  const clientMsgs = [];
  client.on('message', (m) => clientMsgs.push(m));

  await Promise.all([
    host.open({ session: { partyId: id, selfId: hostId, hostId: hostId, role: 'host' } }),
    client.open({
      session: { partyId: id, selfId: clientId, hostId: hostId, role: 'client' },
    }),
  ]);

  assert.equal(client.status, STATUS.READY);
  assert.ok(client.carries());

  const ping = { kind: PING, version: 1, from: clientId };
  await client.send(ping);
  await settle();
  assert.equal(hostMsgs.length, 1);
  assert.equal(hostMsgs[0].kind, PING);

  await host.close();
  await client.close();
  blocked.restore();
  rtc.restore();
  browser.restore();
  resetRtcHub(id);
});

await check('QR mode probe succeeds without a signaling server', async () => {
  const rtc = installMockRtc();
  setRtcContext({ partyId: 'p-probe', peerId: 'x', role: 'host' });
  const transport = createWebRTC({ signal: 'qr', qr: {}, role: 'host', iceServers: [] });
  const result = await transport.probe();
  assert.equal(result.available, true);
  rtc.restore();
});

console.log(`\nwebrtc-qr: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  for (const f of FAIL) console.log(' ', f);
  process.exit(1);
}
