#!/usr/bin/env node
/**
 * Issue #312 — direct WebRTC data channel with mailbox relay blocked.
 *
 * Seams: Playwright context.route (relay abort), partyRuntime self-contained
 * pairing (shared qrExchange), transport manager active name, roster snapshot.
 */

import assert from 'node:assert/strict';
import { launch, ignoreHTTPSErrors } from './browser.mjs';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { installAppAlias } = await import('./lib/appAlias.mjs');
installAppAlias();

const APP = '../../apps/party-tracker/';
const { createWebRTC } = await import(`${APP}lib/transport/webrtc.js`);
const { createQrExchange } = await import(`${APP}lib/transport/qrExchange.js`);
const { SNAPSHOT, PING } = await import(`${APP}lib/core/protocol.js`);
const { STATUS } = await import(`${APP}lib/transport/types.js`);
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
const settle = async (turns = 30) => {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => REAL_SET_TIMEOUT(r, 0));
};

/** Abort every mailbox / relay API route in a Playwright context. */
async function blockRelayRoutes(ctx) {
  const patterns = [
    '**/api/mailbox/**',
    '**/api/members/**',
    '**/api/member/**',
    '**/api/heartbeat/**',
    '**/api/location/**',
  ];
  for (const pattern of patterns) {
    await ctx.route(pattern, (route) => route.abort('failed'));
  }
}

/** Block mailbox fetch in Node partyRuntime tests. */
function blockMailboxFetch() {
  const prior = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (/\/api\/(mailbox|members|member|heartbeat|location)\//.test(target)) {
      throw new Error(`relay blocked: ${target}`);
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

const partyId = () => `p-${Math.random().toString(16).slice(2, 10)}`;

/** Wire offer/answer between host and client QR hooks. */
function wireQrExchange() {
  const exchange = createQrExchange();
  return { exchange, hostQr: exchange.host, clientQr: exchange.client };
}

/**
 * Open host + client WebRTC transports over QR signaling with relay blocked.
 * @throws {Error & { code?: string }}
 */
async function connectDirectPair() {
  const id = partyId();
  const hostId = 'm-host';
  const clientId = 'm-client';
  const blocked = blockMailboxFetch();
  const browser = installBrowserGlobals();
  const rtc = installMockRtc();
  const { hostQr, clientQr } = wireQrExchange();

  const sessionHost = { partyId: id, selfId: hostId, hostId, role: 'host' };
  const sessionClient = { partyId: id, selfId: clientId, hostId, role: 'client' };

  setRtcContext({ partyId: id, peerId: hostId, role: 'host' });
  const host = createWebRTC({ signal: 'qr', qr: hostQr, role: 'host', iceServers: [] });
  const hostFrames = [];
  host.on('message', (m) => hostFrames.push(m));

  setRtcContext({ partyId: id, peerId: clientId, role: 'client' });
  const client = createWebRTC({ signal: 'qr', qr: clientQr, role: 'client', iceServers: [] });
  const clientFrames = [];
  client.on('message', (m) => clientFrames.push(m));

  await Promise.all([
    host.open({ session: sessionHost }),
    client.open({ session: sessionClient }),
  ]);
  await settle(12);

  if (client.status !== STATUS.READY || !client.carries()) {
    const err = new Error(
      `channel never opened on direct path (client status=${client.status}, carries=${client.carries()})`,
    );
    err.code = 'CHANNEL_NEVER_OPENED';
    await host.close();
    await client.close();
    blocked.restore();
    browser.restore();
    rtc.restore();
    resetRtcHub(id);
    throw err;
  }

  const ping = { kind: PING, version: 1, from: clientId };
  await client.send(ping);
  await settle(6);
  if (!hostFrames.some((f) => f.kind === PING)) {
    const err = new Error('channel opened but direct ping did not cross to the host');
    err.code = 'ROSTER_DID_NOT_CONVERGE';
    await host.close();
    await client.close();
    blocked.restore();
    browser.restore();
    rtc.restore();
    resetRtcHub(id);
    throw err;
  }

  return { host, client, clientFrames, blocked, browser, rtc, partyId: id };
}

console.log('webrtc direct with relay blocked (#312)');

await check('two Playwright contexts abort mailbox routes', async () => {
  const browser = await launch();
  const ctxA = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors,
  });
  const ctxB = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors,
  });
  await blockRelayRoutes(ctxA);
  await blockRelayRoutes(ctxB);

  const probe = async (page) =>
    page.evaluate(async () => {
      try {
        await fetch('https://relay.test/api/mailbox/party-abc', {
          method: 'POST',
          body: '{}',
        });
        return 'allowed';
      } catch (e) {
        return e?.message || 'aborted';
      }
    });

  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await pageA.goto('about:blank');
  await pageB.goto('about:blank');

  const [aResult, bResult] = await Promise.all([probe(pageA), probe(pageB)]);
  assert.notEqual(aResult, 'allowed', `context A allowed relay: ${aResult}`);
  assert.notEqual(bResult, 'allowed', `context B allowed relay: ${bResult}`);

  await browser.close();
});

await check('roster snapshot on host appears on joiner over direct WebRTC', async () => {
  const { host, client, clientFrames, blocked, browser, rtc, partyId: id } =
    await connectDirectPair();

  const roster = {
    members: {
      'm-host': { name: 'Host' },
      'm-client': { name: 'Guest' },
    },
  };
  const snap = { kind: SNAPSHOT, roster, version: 4, plan: ['the-beast'] };
  await host.send(snap);
  await settle(12);

  const hit = clientFrames.find((f) => f.kind === SNAPSHOT && f.version === 4);
  if (!hit) {
    const err = new Error(
      `channel opened but roster did not converge (frames=${clientFrames.map((f) => f.kind).join(',') || 'none'})`,
    );
    err.code = 'ROSTER_DID_NOT_CONVERGE';
    await host.close();
    await client.close();
    blocked.restore();
    browser.restore();
    rtc.restore();
    resetRtcHub(id);
    throw err;
  }
  assert.equal(hit.plan?.[0], 'the-beast');

  await host.close();
  await client.close();
  blocked.restore();
  browser.restore();
  rtc.restore();
  resetRtcHub(id);
});

console.log(`\nwebrtc-direct-functional: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  for (const f of FAIL) console.log(' ', f);
  process.exit(1);
}
