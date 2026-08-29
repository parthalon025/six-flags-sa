/**
 * Gap Side Quest / Contribution drafts when submit fires before Profile sign-in.
 * ADR-0030: stash survives dismissed OAuth; flush after Clerk session mints.
 */

import { newMemberId } from '../core/ids.js';

export const STASH_KEY = 'parkbound.contribution-stash';
const MAX_STASH = 20;

function readRaw() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STASH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(items) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STASH_KEY, JSON.stringify(items.slice(-MAX_STASH)));
    return true;
  } catch {
    return false;
  }
}

/** @returns {object[]} */
export function readContributionStash() {
  return readRaw();
}

/** @returns {number} */
export function contributionStashCount() {
  return readRaw().length;
}

/**
 * @param {object} entry gap quest submit payload + scoring hints
 * @returns {boolean}
 */
export function stashGapSubmission(entry) {
  if (typeof window === 'undefined' || !entry?.questId) return false;
  const row = {
    id: newMemberId(),
    questId: String(entry.questId),
    venueId: entry.venueId || null,
    placeId: entry.placeId || null,
    kind: String(entry.kind || entry.questId),
    payload: entry.payload && typeof entry.payload === 'object' ? entry.payload : {},
    lat: Number.isFinite(entry.lat) ? entry.lat : null,
    lng: Number.isFinite(entry.lng) ? entry.lng : null,
    scoreKey: entry.scoreKey || null,
    walkedNear: Boolean(entry.walkedNear),
    action: entry.action || 'first',
    createdAt: Number(entry.createdAt) || Date.now(),
  };
  const next = [...readRaw(), row].slice(-MAX_STASH);
  return writeRaw(next);
}

/** Read and clear the stash (one-shot flush). */
export function takeContributionStash() {
  const items = readRaw();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STASH_KEY);
    } catch {
      /* private mode */
    }
  }
  return items;
}

/**
 * Upload stashed gap quests after Profile sign-in.
 * @param {{ enqueue: (report: object) => Promise<void>, awardQuestXp: (event: object) => Promise<object>, createReport: (input: object) => object }} deps
 */
export async function flushContributionStash(deps) {
  const items = takeContributionStash();
  if (!items.length) return 0;
  for (const item of items) {
    const report = deps.createReport({
      questId: item.questId,
      venueId: item.venueId,
      placeId: item.placeId,
      kind: item.kind,
      payload: item.payload,
      lat: item.lat,
      lng: item.lng,
    });
    await deps.enqueue(report);
    if (item.scoreKey) {
      await deps.awardQuestXp({
        action: item.action || 'first',
        key: item.scoreKey,
        walkedNear: item.walkedNear,
        now: item.createdAt,
      });
    }
  }
  return items.length;
}
