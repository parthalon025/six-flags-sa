/**
 * QR SDP codec — strip, compress, base64url, and classify payloads.
 *
 * Pure module: no DOM, no WebRTC. The handoff doc targets under ~800 bytes so
 * a phone screen in daylight can use a higher error-correction level.
 */

/** @see docs/HANDOFF-self-contained.md */
export const QR_BUDGET_BYTES = 800;

const OFFER_PREFIX = 'o1.';
const ANSWER_PREFIX = 'a1.';

/**
 * Keep the data-channel m-line and session headers; drop AV; host candidates only.
 *
 * @param {string} sdp
 * @returns {string}
 */
export function stripSdpForQr(sdp) {
  const lines = String(sdp || '').split(/\r?\n/);
  const kept = [];
  let inApp = false;
  let inBlock = false;

  for (const line of lines) {
    if (line.startsWith('m=')) {
      inBlock = true;
      inApp = line.startsWith('m=application');
      if (inApp) kept.push(line);
      continue;
    }
    if (!inBlock) {
      if (
        line.startsWith('v=')
        || line.startsWith('o=')
        || line.startsWith('s=')
        || line.startsWith('t=')
        || line.startsWith('a=group:')
        || line.startsWith('a=msid-semantic:')
      ) {
        kept.push(line);
      }
      continue;
    }
    if (!inApp) continue;
    if (line.startsWith('a=candidate:') && !/\styp host(\s|$)/.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\r\n');
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { deflateRawSync } = await import('node:zlib');
  return deflateRawSync(bytes);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { inflateRawSync } = await import('node:zlib');
  return inflateRawSync(bytes);
}

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function unb64url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function packSdp(sdp) {
  const stripped = stripSdpForQr(sdp);
  const raw = new TextEncoder().encode(stripped);
  const compressed = await deflateRaw(raw);
  return b64url(compressed);
}

async function unpackSdp(encoded, prefix) {
  if (typeof encoded !== 'string' || !encoded.startsWith(prefix)) return null;
  try {
    const bytes = await inflateRaw(unb64url(encoded.slice(prefix.length)));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** @param {string} sdp */
export async function encodeOffer(sdp) {
  return `${OFFER_PREFIX}${await packSdp(sdp)}`;
}

/** @param {string} encoded */
export async function decodeOffer(encoded) {
  return unpackSdp(encoded, OFFER_PREFIX);
}

/** @param {string} sdp */
export async function encodeAnswer(sdp) {
  return `${ANSWER_PREFIX}${await packSdp(sdp)}`;
}

/** @param {string} encoded */
export async function decodeAnswer(encoded) {
  return unpackSdp(encoded, ANSWER_PREFIX);
}

/**
 * Host offer as a URL the joiner's stock camera can open.
 *
 * @param {string} origin
 * @param {string} sdp
 */
export async function encodePairUrl(origin, sdp) {
  const base = String(origin).replace(/\/+$/, '');
  const payload = await encodeOffer(sdp);
  return `${base}/pair#${payload}`;
}

/**
 * Tell an invite link from an offer URL or a bare answer payload.
 *
 * @param {string} input
 * @returns {'invite' | 'offer' | 'answer' | null}
 */
export function classifyQrPayload(input) {
  if (typeof input !== 'string' || !input) return null;
  const hash = input.lastIndexOf('#');
  const fragment = hash === -1 ? input : input.slice(hash + 1);
  try {
    const decoded = decodeURIComponent(fragment);
    if (decoded.startsWith(OFFER_PREFIX) || fragment.startsWith(OFFER_PREFIX)) return 'offer';
    if (decoded.startsWith(ANSWER_PREFIX) || fragment.startsWith(ANSWER_PREFIX)) return 'answer';
    if (input.includes('/join') || hash !== -1) {
      const raw = hash === -1 ? input : fragment;
      try {
        const bytes = unb64url(raw);
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (data?.v === 1 && data.p && data.c && data.k) return 'invite';
      } catch {
        /* not an invite */
      }
    }
    return null;
  } catch {
    return null;
  }
}
