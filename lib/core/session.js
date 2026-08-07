// The join credential: the small bundle of facts a phone needs to talk to a
// party — which party, how to reach it, and the key to read it with.
//
// An invite carries all of that in the URL *fragment*. Fragments are never sent
// to a server, so the key that decrypts the party stays between the two phones
// even though the link travels through a QR code, a text message or a browser
// address bar.

import { normalizeCode } from './ids.js';

const INVITE_VERSION = 1;

export const SESSION_STORAGE_KEY = 'ki-session-v3';

export function createSession({
  partyId,
  code,
  keyString,
  token,
  endpoints = [],
  selfId = null,
  role = null,
}) {
  return {
    v: INVITE_VERSION,
    partyId,
    code: normalizeCode(code),
    keyString,
    token,
    // ordered: first one that answers wins, so put the LAN address before the
    // relay. May be empty — webrtc needs no address at all.
    endpoints: [...endpoints],
    selfId,
    role,
  };
}

export function encodeInvite(session, { origin }) {
  const payload = {
    v: INVITE_VERSION,
    p: session.partyId,
    c: session.code,
    k: session.keyString,
    t: session.token,
    e: session.endpoints || [],
  };
  const encoded = b64url(JSON.stringify(payload));
  return `${String(origin).replace(/\/+$/, '')}/join#${encoded}`;
}

/** Accepts a whole invite URL, a bare `#fragment`, or the raw payload. */
export function decodeInvite(input) {
  try {
    if (typeof input !== 'string' || !input) return null;
    const hash = input.lastIndexOf('#');
    let raw = hash === -1 ? input : input.slice(hash + 1);
    // some clients percent-encode the fragment on the way through; base64url is
    // untouched by that, so decoding is either a no-op or a repair.
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* leave it as-is */
    }
    if (!raw) return null;
    const data = JSON.parse(unb64url(raw));
    if (!data || data.v !== INVITE_VERSION) return null;
    if (!isText(data.p) || !isText(data.c) || !isText(data.k)) return null;
    if (data.t !== undefined && typeof data.t !== 'string') return null;
    return {
      partyId: data.p,
      code: normalizeCode(data.c),
      keyString: data.k,
      token: data.t || '',
      endpoints: Array.isArray(data.e) ? data.e.filter((u) => isText(u)) : [],
    };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- storage ------ */

export function saveSession(session) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* private mode, quota, disabled storage — losing the session is survivable */
  }
}

export function loadSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    return session && typeof session === 'object' ? session : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* nothing to do if storage is unavailable */
  }
}

/* ---------------------------------------------------------- helpers ------ */

const isText = (v) => typeof v === 'string' && v.length > 0;

// utf-8 safe base64url, without pulling in crypto.js or Buffer
const b64url = (str) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function unb64url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
