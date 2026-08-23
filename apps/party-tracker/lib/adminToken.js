/**
 * Token + Operator gate for operator routes (/api/metrics, traces export,
 * consolidate export). 404 when unconfigured in production and the session
 * is not an Operator Profile (Clerk private_metadata.admin).
 */

import { clerkUserIsGodmode } from './godmode.js';

function operatorToken() {
  return process.env.GUEST_TRACES_TOKEN || process.env.METRICS_TOKEN || '';
}

function tokenMatches(request, token) {
  const header = request.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const query = new URL(request.url).searchParams.get('token') || '';
  return bearer === token || query === token;
}

/**
 * @param {Request} request
 * @param {{ godmode?: boolean }} [opts]
 */
export function adminPermitted(request, { godmode = false } = {}) {
  if (godmode) return true;
  const token = operatorToken();
  if (!token) return process.env.NODE_ENV !== 'production';
  return tokenMatches(request, token);
}

export function adminTokenConfigured() {
  return Boolean(operatorToken());
}

/** Clerk Backend private_metadata.admin on the signed-in session. */
export async function clerkGodmodeFromRequest() {
  try {
    const { auth, clerkClient } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    if (!userId) return false;
    const client = typeof clerkClient === 'function' ? await clerkClient() : clerkClient;
    const user = await client.users.getUser(userId);
    return clerkUserIsGodmode(user);
  } catch {
    return false;
  }
}

export async function requestIsOperator(request) {
  if (adminPermitted(request)) return true;
  return clerkGodmodeFromRequest();
}
