/**
 * Soft-gate session helpers (EP.2–EP.3).
 * Auth.js-shaped client API: anonymous may browse, join a Party by name, and
 * file in-party Ride reports; contribute / gap Side Quest submit / planner sync need userId.
 */

import { requiresSignedIn } from '@party-tracker/shared/schemas.js';
import { rankFromXp, scoreSideQuest, titleFromXp } from '@party-tracker/shared/questScore.js';
import { clearProfileCache, readProfileCache, writeProfileCache } from './profileCache.js';

const SESSION_KEY = 'parkbound.session';

/** @returns {{ userId: string, email: string, displayName: string, rank?: string, title?: string | null, xp?: number } | null} */
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
 * @param {'party'|'contribute'|'adventure'|'planner'|'world'} action
 * @param {{ userId?: string } | null} session
 */
export function softGateBlocks(action, session) {
  return requiresSignedIn(session?.userId, action);
}

/**
 * Dev / first-ship magic-link completion: exchange email for a local session
 * and cache the profile offline. Replace body with Auth.js callbacks later.
 */
function titleCaseName(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Guest';
  return s
    .split(/([\s._-]+)/)
    .map((part) => (/^[\s._-]+$/.test(part) ? part.replace(/[._-]/g, ' ') : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || 'Guest';
}

export async function completeMagicSignIn({ email, displayName }) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean || !clean.includes('@')) throw new Error('Enter a valid email');
  const userId = `usr_${clean.replace(/[^a-z0-9]/g, '_').slice(0, 40)}`;
  let keep = null;
  try {
    const existing = await readProfileCache();
    if (existing?.userId === userId) keep = existing;
  } catch {
    /* IndexedDB may be unavailable */
  }
  const xp = Number(keep?.xp) || 0;
  const rank = keep?.rank || rankFromXp(xp);
  const title = keep?.title ?? titleFromXp(xp);
  const session = {
    userId,
    email: clean,
    displayName: titleCaseName(displayName || clean.split('@')[0] || 'Guest'),
    rank,
    title,
    xp,
  };
  writeLocalSession(session);
  try {
    await writeProfileCache({
      userId: session.userId,
      displayName: session.displayName,
      email: session.email,
      avatarKey: keep?.avatarKey ?? null,
      rank,
      title,
      xp,
      reputation: Number(keep?.reputation) || 0,
      impactHelped: Number(keep?.impactHelped) || 0,
      scoredKeys: Array.isArray(keep?.scoredKeys) ? keep.scoredKeys : [],
      awardedByKey: keep?.awardedByKey && typeof keep.awardedByKey === 'object' ? keep.awardedByKey : {},
      lastQuestDay: keep?.lastQuestDay || null,
      guests: Array.isArray(keep?.guests) ? keep.guests : [],
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
    rank: cached.rank || rankFromXp(cached.xp),
    title: cached.title ?? titleFromXp(cached.xp),
    xp: Number(cached.xp) || 0,
    fromCache: true,
  };
}

/**
 * Award Side Quest XP onto the cached Profile. Rank-up is the reward.
 * Session xp/rank are a display mirror of that Profile, not a Member ledger.
 * @param {object} event scoreSideQuest event fields
 */
export async function awardQuestXp(event) {
  const live = readLocalSession();
  let cache = null;
  try {
    cache = await readProfileCache();
  } catch {
    cache = null;
  }
  const userId = live?.userId || cache?.userId || null;
  const hasProfile = Boolean(userId);
  const base = hasProfile
    ? {
      xp: Number(cache?.xp ?? live?.xp) || 0,
      rank: cache?.rank || live?.rank || 'visitor',
      reputation: Number(cache?.reputation) || 0,
      scoredKeys: Array.isArray(cache?.scoredKeys) ? cache.scoredKeys : [],
      awardedByKey: cache?.awardedByKey && typeof cache.awardedByKey === 'object' ? cache.awardedByKey : {},
      lastQuestDay: cache?.lastQuestDay || null,
    }
    : { xp: 0, scoredKeys: [] };
  const result = scoreSideQuest(base, { ...event, hasProfile });
  if (!userId) return result;
  const nextSnap = {
    ...(cache || {}),
    userId,
    displayName: cache?.displayName || live?.displayName,
    email: cache?.email || live?.email,
    ...result.profile,
  };
  try {
    await writeProfileCache(nextSnap);
  } catch {
    /* private mode */
  }
  if (live?.userId) {
    writeLocalSession({
      ...live,
      xp: result.profile.xp,
      rank: result.profile.rank,
      title: result.profile.title,
    });
  }
  return result;
}
