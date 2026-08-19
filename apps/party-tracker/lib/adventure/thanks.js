'use client';

/**
 * Thanks the finder — client side of the Death Stranding like.
 *
 * One tap per Contribution per phone, optimistic: the tap is remembered
 * locally at once, the POST rides behind it, and a park dead zone parks the
 * send in a durable outbox (lib/transport's createOfflineQueue — the same
 * bounded, reload-surviving queue partyRuntime uses) until the phone is back
 * online. The server dedupes again per (contribution, thanker), so a replay
 * can never double-count.
 */

import { createOfflineQueue } from '@/lib/transport/offlineQueue';

const SENT_KEY = 'parkbound.thanks.sent';
const SENT_MAX = 500;

const outbox = createOfflineQueue({ storageKey: 'parkbound.thanks.queue.v1', max: SENT_MAX });

function readSent() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SENT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSent(ids) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SENT_KEY, JSON.stringify(ids.slice(-SENT_MAX)));
  } catch {
    /* storage full / private mode — the server dedupe still holds */
  }
}

/** Contribution ids this phone already thanked. */
export function thankedIds() {
  return new Set(readSent());
}

export function hasThanked(contributionId) {
  return thankedIds().has(contributionId);
}

function markThanked(contributionId) {
  const ids = readSent().filter((id) => id !== contributionId);
  ids.push(contributionId);
  writeSent(ids);
}

async function post({ contributionId, thankerId }) {
  const res = await fetch('/api/contributions/thanks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contributionId, thankerId }),
  });
  if (!res.ok && res.status !== 404 && res.status !== 400) {
    throw new Error(`thanks upload ${res.status}`);
  }
}

/**
 * Thank a Contribution's finder. Remembers the tap immediately; network
 * failure queues the send for flushThanksQueue(). Repeat taps are no-ops.
 * @returns {Promise<boolean>} true when this tap was new on this phone
 */
export async function sendThanks({ contributionId, thankerId }) {
  if (!contributionId || !thankerId) return false;
  if (hasThanked(contributionId)) return false;
  markThanked(contributionId);
  try {
    await post({ contributionId, thankerId });
  } catch {
    await outbox.send({ contributionId, thankerId });
  }
  return true;
}

/** Retry queued thanks — call when the network comes back. */
export async function flushThanksQueue() {
  const pending = outbox.drain();
  let sent = 0;
  for (const item of pending) {
    try {
      await post(item);
      sent += 1;
    } catch {
      await outbox.send(item);
    }
  }
  return sent;
}
