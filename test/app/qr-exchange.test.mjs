#!/usr/bin/env node
/**
 * qrExchange — in-memory SDP handoff for QR WebRTC pairing (#309).
 *
 * Seam: createQrExchange host/client hooks and UI-side submitOffer/submitAnswer.
 */

import assert from 'node:assert/strict';

const { createQrExchange } = await import(
  '../../apps/party-tracker/lib/transport/qrExchange.js',
);

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

const settle = async (turns = 4) => {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setTimeout(r, 0));
};

console.log('qrExchange (#309)');

await check('host offer reaches client waitForOffer', async () => {
  const { host, client } = createQrExchange();
  let offer = null;
  const waiting = client.waitForOffer().then((v) => {
    offer = v;
  });
  await host.onOfferReady('o1.test-offer');
  await waiting;
  assert.equal(offer, 'o1.test-offer');
});

await check('client submitOffer unblocks host waitForOfferEncoded', async () => {
  const { host, client } = createQrExchange();
  let seen = null;
  const waiting = host.waitForOfferEncoded().then((v) => {
    seen = v;
  });
  await client.submitOffer('o1.from-joiner-scan');
  await waiting;
  assert.equal(seen, 'o1.from-joiner-scan');
});

await check('host submitAnswer unblocks client waitForAnswerEncoded', async () => {
  const { host, client } = createQrExchange();
  let seen = null;
  const waiting = client.waitForAnswerEncoded().then((v) => {
    seen = v;
  });
  await host.submitAnswer('a1.from-host-scan');
  await waiting;
  assert.equal(seen, 'a1.from-host-scan');
});

await check('full host-client round trip via UI injection', async () => {
  const { host, client } = createQrExchange();

  await host.onOfferReady('o1.host-generated');
  await client.submitOffer('o1.host-generated');

  await client.onAnswerReady('a1.client-generated');
  const answer = await host.waitForAnswer();
  assert.equal(answer, 'a1.client-generated');
});

console.log(`\nqr-exchange: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  for (const f of FAIL) console.log(' ', f);
  process.exit(1);
}
