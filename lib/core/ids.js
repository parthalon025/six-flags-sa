// Identifier minting. Pure, no imports, and identical in the browser and in
// Node 18+ — everything goes through globalThis.crypto, which both provide.

/** No I, O, 0 or 1: the code gets read aloud and typed in by hand. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomBytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/**
 * The alphabet is exactly 32 long and 256 is a multiple of it, so a plain
 * modulo maps bytes onto letters evenly — no rejection sampling needed.
 */
export function newPartyCode(len = 6) {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

const HEX = '0123456789abcdef';

function hex(n) {
  const bytes = randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i += 1) out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return out;
}

/** 16 hex chars — 64 bits, enough that two phones in a party never collide. */
export const newMemberId = () => hex(8);

/** 32 hex chars — 128 bits, because this one is a bearer credential. */
export const newToken = () => hex(16);

/** Forgiving on input: users paste codes with spaces, dashes and lowercase. */
export const normalizeCode = (raw) =>
  String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, '')
    .slice(0, 6);
