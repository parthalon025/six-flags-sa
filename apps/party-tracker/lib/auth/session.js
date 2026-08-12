/**
 * Soft-gate session helpers (EP.2–EP.3).
 * Auth.js-shaped client API: anonymous may browse; party/contribute/adventure/planner need userId.
 */

import { requiresSignedIn } from '@party-tracker/shared/schemas.js';
import { clearProfileCache, readProfileCache, writeProfileCache } from './profileCache.js';

const SESSION_KEY = 'parkbound.session';

/** @returns {{ userId: string, email: string, displayName: string, rank?: string } | null} */
export function readLocalSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeLocalSession(session) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearLocalSession() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_KEY);
}

/**
 * @param {'party'|'contribute'|'adventure'|'planner'} action
 * @param {{ userId?: string } | null} session
 */
export function softGateBlocks(action, session) {
  return requiresSignedIn(session?.userId, action);
}

/**
 * Dev / first-ship magic-link completion: exchange email for a local session
 * and cache the profile offline. Replace body with Auth.js callbacks later.
 */
export async function completeMagicSignIn({ email, displayName }) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean || !clean.includes('@')) throw new Error('Enter a valid email');
  const userId = `usr_${clean.replace(/[^a-z0-9]/g, '_').slice(0, 40)}`;
  const session = {
    userId,
    email: clean,
    displayName: String(displayName || clean.split('@')[0] || 'Guest').slice(0, 40),
    rank: 'visitor',
  };
  writeLocalSession(session);
  try {
    await writeProfileCache({
      userId: session.userId,
      displayName: session.displayName,
      email: session.email,
      avatarKey: null,
      rank: 'visitor',
      xp: 0,
      reputation: 0,
      impactHelped: 0,
    });
  } catch {
    /* IndexedDB may be unavailable (private mode / Node); session still works. */
  }
  return session;
}

export async function signOutLocal() {
  clearLocalSession();
  await clearProfileCache();
}

/** Prefer live session; fall back to IndexedDB when offline. */
export async function resolveSession() {
  const live = readLocalSession();
  if (live?.userId) return live;
  const cached = await readProfileCache();
  if (!cached?.userId) return null;
  return {
    userId: cached.userId,
    email: cached.email || null,
    displayName: cached.displayName,
    rank: cached.rank || 'visitor',
    fromCache: true,
  };
}
