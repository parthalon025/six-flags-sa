/**
 * Thanks the finder — client side of the Death Stranding like.
 *
 * One tap per Contribution per phone, optimistic: the tap is remembered
 * locally at once, the POST rides behind it, and a park dead zone queues the
 * send until the phone is back online. The server dedupes again per
 * (contribution, thanker), so a replay can never double-count.
 */

const SENT_KEY = 'parkbound.thanks.sent';
const QUEUE_KEY = 'parkbound.thanks.queue';
const SENT_MAX = 500;

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / private mode — the server dedupe still holds */
  }
}

/** Contribution ids this phone already thanked. */
export function thankedIds() {
  return new Set(readJson(SENT_KEY, []));
}

export function hasThanked(contributionId) {
  return thankedIds().has(contributionId);
}

function markThanked(contributionId) {
  const ids = readJson(SENT_KEY, []).filter((id) => id !== contributionId);
  ids.push(contributionId);
  writeJson(SENT_KEY, ids.slice(-SENT_MAX));
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
    const queue = readJson(QUEUE_KEY, []).filter((q) => q?.contributionId !== contributionId);
    queue.push({ contributionId, thankerId });
    writeJson(QUEUE_KEY, queue.slice(-SENT_MAX));
  }
  return true;
}

/** Retry queued thanks — call when the network comes back. */
export async function flushThanksQueue() {
  const queue = readJson(QUEUE_KEY, []);
  if (!queue.length) return 0;
  const remaining = [];
  let sent = 0;
  for (const item of queue) {
    try {
      await post(item);
      sent += 1;
    } catch {
      remaining.push(item);
    }
  }
  writeJson(QUEUE_KEY, remaining);
  return sent;
}
