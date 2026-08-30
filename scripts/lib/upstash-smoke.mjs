/**
 * Optional CI smoke test against real Upstash test credentials (#377).
 *
 * Skips (not fails) when no credentials are configured — this is meant to
 * run on every CI push/PR, most of which have no `UPSTASH_REDIS_REST_*`
 * secret available (forks, local runs), and absence must never be red.
 */

/** @param {NodeJS.ProcessEnv} [env] */
export function shouldRunUpstashSmoke(env = process.env) {
  const url = String(env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = String(env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return Boolean(url && token);
}

/** A key namespaced so a smoke run can never collide with real app data. */
function smokeKey() {
  return `ki:_smoke:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * PING, then a SET / GET / DEL round trip on a disposable key. Never touches
 * an `ki:party:` / `ki:zbox:` / etc. key a real party could be using.
 *
 * @param {object} opts
 * @param {string} opts.urlBase
 * @param {string} opts.token
 * @param {typeof fetch} [opts.fetchImpl] injectable for tests
 */
export async function runUpstashSmoke({ urlBase, token, fetchImpl = fetch }) {
  if (!urlBase || !token) {
    throw new Error('runUpstashSmoke: urlBase and token are required');
  }

  const call = async (command) => {
    const res = await fetchImpl(urlBase, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Upstash ${res.status} on ${command[0]}`);
    return (await res.json()).result;
  };

  const ping = await call(['PING']);
  if (ping !== 'PONG') throw new Error(`Unexpected PING reply: ${JSON.stringify(ping)}`);

  const key = smokeKey();
  const value = `smoke-${process.pid}`;
  const set = await call(['SET', key, value, 'EX', '30']);
  if (set !== 'OK') throw new Error(`Unexpected SET reply: ${JSON.stringify(set)}`);

  const got = await call(['GET', key]);
  if (got !== value) throw new Error(`GET returned ${JSON.stringify(got)}, expected ${JSON.stringify(value)}`);

  const del = await call(['DEL', key]);
  if (Number(del) !== 1) throw new Error(`DEL removed ${del} key(s), expected 1`);

  return { ok: true, ping, roundTrip: { key, wrote: value, read: got } };
}
