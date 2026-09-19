#!/usr/bin/env node
/**
 * Issue #309 — QR SDP codec at the qrSignal seam.
 *
 * Seams: encodeOffer/decodeOffer, encodeAnswer/decodeAnswer, classifyQrPayload,
 * and encodePairUrl for the host offer link.
 */

import assert from 'node:assert/strict';

const APP = '../../apps/party-tracker/';
const {
  QR_BUDGET_BYTES,
  encodeOffer,
  decodeOffer,
  encodeAnswer,
  decodeAnswer,
  encodePairUrl,
  classifyQrPayload,
  stripSdpForQr,
} = await import(`${APP}lib/transport/qrSignal.js`);

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

/** Realistic multi-interface SDP — host + srflx + relay candidates. */
const SAMPLE_SDP = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=msid-semantic: WMS',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:111 opus/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:96 VP8/90000',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:abc',
  'a=ice-pwd:def',
  'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  'a=candidate:1 1 udp 2122260223 192.168.1.10 54321 typ host',
  'a=candidate:2 1 udp 1686052607 203.0.113.5 54321 typ srflx raddr 192.168.1.10 rport 54321',
  'a=candidate:3 1 udp 41885439 198.51.100.2 54321 typ relay raddr 203.0.113.5 rport 54321',
  'a=candidate:4 1 udp 2122260223 10.0.0.5 54322 typ host',
  'a=end-of-candidates',
].join('\r\n');

console.log('qrSignal codec (#309)');

await check('stripSdpForQr keeps only the data-channel m-line and host candidates', () => {
  const stripped = stripSdpForQr(SAMPLE_SDP);
  assert.match(stripped, /m=application/);
  assert.doesNotMatch(stripped, /m=audio/);
  assert.doesNotMatch(stripped, /m=video/);
  assert.match(stripped, /typ host/);
  assert.doesNotMatch(stripped, /typ srflx/);
  assert.doesNotMatch(stripped, /typ relay/);
});

await check('offer round-trips through encode and decode', async () => {
  const encoded = await encodeOffer(SAMPLE_SDP);
  const back = await decodeOffer(encoded);
  assert.equal(back, stripSdpForQr(SAMPLE_SDP));
});

await check('answer round-trips through encode and decode', async () => {
  const offer = stripSdpForQr(SAMPLE_SDP);
  const answerSdp = offer.replace('a=setup:actpass', 'a=setup:active');
  const encoded = await encodeAnswer(answerSdp);
  const back = await decodeAnswer(encoded);
  assert.equal(back, answerSdp);
});

await check('encoded offer stays under the QR byte budget for a realistic SDP', async () => {
  const encoded = await encodeOffer(SAMPLE_SDP);
  assert.ok(encoded.length <= QR_BUDGET_BYTES, `offer ${encoded.length} > ${QR_BUDGET_BYTES}`);
});

await check('encodePairUrl puts the offer in a /pair fragment', async () => {
  const url = await encodePairUrl('https://example.test', SAMPLE_SDP);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/pair');
  assert.ok(parsed.hash.length > 2);
  const offer = await decodeOffer(parsed.hash.slice(1));
  assert.equal(offer, stripSdpForQr(SAMPLE_SDP));
});

await check('classifyQrPayload distinguishes invite, offer, and answer', async () => {
  const { encodeInvite } = await import(`${APP}lib/core/session.js`);
  const inviteUrl = encodeInvite(
    { partyId: 'p1', code: 'ABC234', keyString: 'k', token: '', endpoints: [] },
    { origin: 'https://example.test' },
  );
  const offerUrl = await encodePairUrl('https://example.test', SAMPLE_SDP);
  const answer = await encodeAnswer(stripSdpForQr(SAMPLE_SDP));

  assert.equal(classifyQrPayload(inviteUrl), 'invite');
  assert.equal(classifyQrPayload(offerUrl), 'offer');
  assert.equal(classifyQrPayload(answer), 'answer');
  assert.equal(classifyQrPayload('garbage'), null);
});

await check('malformed payloads return null rather than throwing', async () => {
  assert.equal(await decodeOffer(''), null);
  assert.equal(await decodeOffer('not-valid'), null);
  assert.equal(await decodeAnswer(''), null);
});

console.log(`\nqr-signal: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  for (const f of FAIL) console.log(' ', f);
  process.exit(1);
}
