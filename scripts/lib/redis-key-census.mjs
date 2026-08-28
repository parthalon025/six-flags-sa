/**
 * Operator SCAN census — grouped key counts by prefix (#389).
 *
 * `scripts/lib` seam: this file must not reach app source (mirrors
 * production-redis-guard.mjs) so it stays runnable standalone, outside the
 * app's workspace. It talks to Upstash's REST API directly rather than
 * importing apps/party-tracker/lib/serverStore.js.
 *
 *   node scripts/redis-key-census.mjs
 */

/** Every key prefix this app writes, in the shape `ki:{kind}:...`. */
export const KEY_PREFIXES = [
  { id: 'party', prefix: 'ki:party:', label: 'Party state' },
  { id: 'code', prefix: 'ki:code:', label: 'Party join codes' },
  { id: 'mailbox', prefix: 'ki:zbox:', label: 'Mailbox (sorted-set message queues)' },
  { id: 'seq', prefix: 'ki:seq:', label: 'Mailbox sequence counters' },
  { id: 'subs', prefix: 'ki:subs:', label: 'Push subscriptions' },
  { id: 'rateLimit', prefix: 'ki:rl:', label: 'Rate-limit buckets' },
  { id: 'guestTraces', prefix: 'ki:guest-traces:', label: 'Guest walk traces' },
  { id: 'world', prefix: 'ki:world:', label: 'Park-wide Marks + Thanks' },
];

/** Which known bucket a key belongs to, or `'other'` for an unrecognised prefix. */
export function classifyKey(key) {
  for (const { id, prefix } of KEY_PREFIXES) {
    if (key.startsWith(prefix)) return id;
  }
  return 'other';
}

/**
 * Group a flat key list into counts per bucket.
 * @param {string[]} keys
 * @returns {{ counts: Record<string, number>, other: number, total: number }}
 */
export function censusFromKeys(keys) {
  const counts = Object.fromEntries(KEY_PREFIXES.map(({ id }) => [id, 0]));
  let other = 0;
  for (const key of keys) {
    const id = classifyKey(key);
    if (id === 'other') other += 1;
    else counts[id] += 1;
  }
  const total = keys.length;
  return { counts, other, total };
}

/** Render a census as an aligned text table for operator output. */
export function formatCensus(census) {
  const rows = [
    ...KEY_PREFIXES.map(({ id, label }) => [label, census.counts[id]]),
    ['(unrecognised prefix)', census.other],
    ['Total', census.total],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, count]) => `${label.padEnd(width)}  ${count}`).join('\n');
}

/**
 * Real Upstash SCAN, one page. Injectable in `runKeyCensus` so tests never
 * need a live Redis connection.
 * @param {string} cursor
 * @param {{ urlBase: string, token: string, match?: string, count?: number }} opts
 * @returns {Promise<{ cursor: string, keys: string[] }>}
 */
export async function upstashScanPage(
  cursor,
  { urlBase, token, match = 'ki:*', count = 1000 },
) {
  const res = await fetch(urlBase, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SCAN', cursor, 'MATCH', match, 'COUNT', String(count)]),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const { result } = await res.json();
  const [nextCursor, keys] = result;
  return { cursor: String(nextCursor), keys: keys || [] };
}

/**
 * Page through every `ki:*` key via SCAN and return the grouped census.
 * @param {object} [opts]
 * @param {(cursor: string) => Promise<{ cursor: string, keys: string[] }>} [opts.scanPage]
 *   defaults to a real Upstash SCAN using env credentials; pass a fake for tests.
 * @param {number} [opts.maxPages] safety cap so a misbehaving SCAN cannot loop forever.
 */
export async function runKeyCensus({
  scanPage = (cursor) =>
    upstashScanPage(cursor, {
      urlBase: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
      token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
    }),
  maxPages = 10_000,
} = {}) {
  const keys = [];
  let cursor = '0';
  let pages = 0;
  do {
    const page = await scanPage(cursor);
    keys.push(...page.keys);
    cursor = page.cursor;
    pages += 1;
    if (pages > maxPages) {
      throw new Error(`runKeyCensus: exceeded ${maxPages} SCAN pages without cursor reaching '0'`);
    }
  } while (cursor !== '0');
  return { ...censusFromKeys(keys), pages };
}
