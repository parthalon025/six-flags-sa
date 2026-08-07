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
