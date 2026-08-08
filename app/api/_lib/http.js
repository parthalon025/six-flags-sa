// Shared response and input helpers for the cloud-fallback API.
//
// An underscored directory is not routable, so this sits next to the routes it
// serves without becoming an endpoint itself.

import { NextResponse } from 'next/server';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export const badRequest = (message = 'Malformed request') => json({ error: message }, 400);
export const notFound = (message = 'Not found') => json({ error: message }, 404);
export const forbidden = (message = 'Forbidden') => json({ error: message }, 403);
export const serverError = (message = 'Server error') => json({ error: message }, 500);

/**
 * `Retry-After` is not decoration: a client that backs off on a number the
 * server named recovers, and one that retries blindly turns a rate limit into
 * the very load it was meant to shed.
 */
export const tooManyRequests = (retryAfter = 60) =>
  NextResponse.json(
    { error: 'Slow down' },
    { status: 429, headers: { ...NO_STORE, 'Retry-After': String(Math.max(1, retryAfter)) } },
  );

/**
 * A response the CDN may hold and reuse. Only correct for content with no
 * party in it — everything party-shaped goes through `json` and is no-store.
 *
 * `s-maxage` is the shared-cache lifetime, so this is what makes a Vercel edge
 * cache a real cache: one upstream fetch per region per window, however many
 * phones ask. `stale-while-revalidate` then means the window expiring costs a
 * background refresh rather than a slow request for whoever asked first.
 */
export const jsonCached = (body, { sMaxAge, swr, maxAge = 0, status = 200 }) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
    },
  });

/**
 * Body reader that cannot throw. Malformed JSON, a truncated upload and an
 * oversized body all read as `null`, which every caller turns into a 400 —
 * a route must never let a parse error escape as an unhandled 500.
 */
export async function readJson(request, limit = 64 * 1024) {
  const raw = await request.text().catch(() => null);
  if (raw == null || raw.length > limit) return null;
  if (!raw.trim()) return {}; // an empty body is an empty object, not an error
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Ids are opaque to this layer; it only cares that they are short and present. */
export const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 64;

export const str = (value, max) => String(value ?? '').slice(0, max);
