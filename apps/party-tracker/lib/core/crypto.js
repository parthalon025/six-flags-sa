// Envelope sealing. AES-GCM over WebCrypto, so the same code runs in the
// browser and in Node 18+ — globalThis.crypto.subtle exists in both. No Buffer
// anywhere: base64url is done by hand.
//
// The key never leaves the devices in the party. It rides in the fragment of an
// invite URL (see session.js), so a relay carrying our envelopes only ever sees
// { v, pid, iv, ct } and can route on pid without reading a byte of the frame.

import { PROTOCOL_VERSION } from './protocol.js';

const ALGO = 'AES-GCM';
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function b64urlEncode(uint8) {
  let bin = '';
  // chunked: String.fromCharCode(...huge) blows the argument limit
  for (let i = 0; i < uint8.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, uint8.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const padded = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function generateKey() {
  return globalThis.crypto.subtle.generateKey({ name: ALGO, length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function exportKey(key) {
  const raw = await globalThis.crypto.subtle.exportKey('raw', key);
  return b64urlEncode(new Uint8Array(raw));
}

export function importKey(str) {
  return globalThis.crypto.subtle.importKey('raw', b64urlDecode(str), { name: ALGO }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function seal(key, partyId, frame) {
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(iv); // fresh every call — a reused IV leaks the plaintext
  const ct = await globalThis.crypto.subtle.encrypt(
    // the party id is authenticated but not encrypted, which is what stops a
    // sealed envelope being relabelled and replayed into a different party:
    // change pid and the tag no longer verifies.
    { name: ALGO, iv, additionalData: encoder.encode(partyId) },
    key,
    encoder.encode(JSON.stringify(frame)),
  );
  return {
    v: PROTOCOL_VERSION,
    pid: partyId,
    iv: b64urlEncode(iv),
    ct: b64urlEncode(new Uint8Array(ct)),
  };
}

/**
 * Returns the frame, or null for anything at all that went wrong — wrong key,
 * tampered bytes, wrong version, relabelled party. Callers get one boring
 * failure mode instead of a taxonomy of exceptions, and an attacker learns
 * nothing from which check failed.
 */
export async function open(key, sealed) {
  try {
    if (!sealed || typeof sealed !== 'object') return null;
    if (sealed.v !== PROTOCOL_VERSION) return null;
    if (typeof sealed.pid !== 'string' || typeof sealed.iv !== 'string') return null;
    if (typeof sealed.ct !== 'string') return null;
    const iv = b64urlDecode(sealed.iv);
    if (iv.length !== IV_BYTES) return null;
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: ALGO, iv, additionalData: encoder.encode(sealed.pid) },
      key,
      b64urlDecode(sealed.ct),
    );
    return JSON.parse(decoder.decode(plain));
  } catch {
    return null;
  }
}
