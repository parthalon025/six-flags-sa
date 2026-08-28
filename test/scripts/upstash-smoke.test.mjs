/**
 * Optional Upstash CI smoke test (#377).
 *
 *   node test/scripts/upstash-smoke.test.mjs
 */
import assert from 'node:assert/strict';
import { runUpstashSmoke, shouldRunUpstashSmoke } from '../../scripts/lib/upstash-smoke.mjs';

// Decision function: only runs when both credentials are present.
assert.equal(shouldRunUpstashSmoke({}), false);
assert.equal(shouldRunUpstashSmoke({ UPSTASH_REDIS_REST_URL: 'https://x' }), false);
assert.equal(shouldRunUpstashSmoke({ UPSTASH_REDIS_REST_TOKEN: 'tok' }), false);
assert.equal(
  shouldRunUpstashSmoke({ UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 'tok' }),
  true,
);
assert.equal(
  shouldRunUpstashSmoke({ UPSTASH_REDIS_REST_URL: '  ', UPSTASH_REDIS_REST_TOKEN: 'tok' }),
  false,
  'whitespace-only url does not count as configured',
);

// runUpstashSmoke requires both a url and a token.
await assert.rejects(() => runUpstashSmoke({ urlBase: '', token: 'tok' }));
await assert.rejects(() => runUpstashSmoke({ urlBase: 'https://x', token: '' }));

// A fake Upstash: PING → PONG, SET → OK, GET → the value just written,
// DEL → 1. Asserts the exact command sequence and the returned shape,
// without a live Redis connection.
{
  const calls = [];
  const store = new Map();
  const fetchImpl = async (url, { body }) => {
    assert.equal(url, 'https://fake.upstash.io');
    const command = JSON.parse(body);
    calls.push(command);
    const [op, ...rest] = command;
    let result;
    if (op === 'PING') result = 'PONG';
    else if (op === 'SET') {
      const [key, value] = rest;
      store.set(key, value);
      result = 'OK';
    } else if (op === 'GET') {
      result = store.get(rest[0]) ?? null;
    } else if (op === 'DEL') {
      result = store.delete(rest[0]) ? 1 : 0;
    } else {
      throw new Error(`unexpected command ${op}`);
    }
    return { ok: true, json: async () => ({ result }) };
  };

  const outcome = await runUpstashSmoke({
    urlBase: 'https://fake.upstash.io',
    token: 'test-token',
    fetchImpl,
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.ping, 'PONG');
  assert.equal(outcome.roundTrip.read, outcome.roundTrip.wrote);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['PING', 'SET', 'GET', 'DEL'],
    'exercises PING then a full SET/GET/DEL round trip, in order',
  );
  assert.ok(calls[1][1].startsWith('ki:_smoke:'), 'the round-trip key is namespaced away from real app keys');
  assert.equal(calls[1][3], 'EX', 'SET always carries an expiry so a failed cleanup cannot leak a key');
}

// A non-PONG PING reply is treated as a real failure, not swallowed.
{
  const fetchImpl = async () => ({ ok: true, json: async () => ({ result: 'NOT-PONG' }) });
  await assert.rejects(
    () => runUpstashSmoke({ urlBase: 'https://fake.upstash.io', token: 't', fetchImpl }),
    /Unexpected PING reply/,
  );
}

// A non-ok HTTP response surfaces as a thrown error, not a silent pass.
{
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(
    () => runUpstashSmoke({ urlBase: 'https://fake.upstash.io', token: 't', fetchImpl }),
    /Upstash 503/,
  );
}

console.log('upstash-smoke: ok');
