/**
 * A small in-memory stand-in for the Upstash REST API, for tests that need
 * `usingRedis === true` without real credentials or a network call.
 *
 * It executes exactly the primitives lib/serverStore.js, lib/rateLimit.js and
 * lib/worldMarks.js actually send — GET/SET(NX/EX)/DEL/EXISTS/EXPIRE/INCR,
 * the sorted-set trio the mailbox uses, the hash trio subscriptions use, the
 * list trio guest traces use, and PING — plus EVAL, dispatched by exact
 * script text against handlers the caller registers. That last part is the
 * honesty check: a test only passes if the *real* Lua string the module sends
 * is the one whose semantics this fake was told to run, so a script edit that
 * changes behavior without changing the string cannot slip past silently.
 *
 * Every request is recorded in `calls` so a test can assert on the exact
 * shape sent — single command POST, `/pipeline` POST, EVAL key/arg order —
 * not just on the store's end state.
 */

function parseScoreBound(raw) {
  if (raw === '+inf') return { value: Infinity, exclusive: false };
  if (raw === '-inf') return { value: -Infinity, exclusive: false };
  if (typeof raw === 'string' && raw.startsWith('(')) {
    return { value: Number(raw.slice(1)), exclusive: true };
  }
  return { value: Number(raw), exclusive: false };
}

function normRange(len, start, stop) {
  const s = Number(start);
  const e = Number(stop);
  const lo = Math.max(0, s < 0 ? len + s : s);
  const hiRaw = e < 0 ? len + e : e;
  const hi = Math.min(len - 1, hiRaw);
  return [lo, hi];
}

export function createStore() {
  return {
    strings: new Map(),
    zsets: new Map(), // key -> Map<member, score>
    hashes: new Map(), // key -> Map<field, value>
    lists: new Map(), // key -> array, index 0 is the head
    ttl: new Map(), // key -> seconds (recorded, not enforced — tests assert the value)
  };
}

function anyBucketHas(store, key) {
  return store.strings.has(key) || store.zsets.has(key) || store.hashes.has(key) || store.lists.has(key);
}

/**
 * Exported so an EVAL handler can be written as the same sequence of
 * `redis.call(...)` primitives the real script performs, instead of a
 * hand-rolled reimplementation that could quietly drift from it.
 */
export function execCommand(store, cmd, evalScripts) {
  const [op, ...rest] = cmd;
  switch (op) {
    case 'GET': {
      const [key] = rest;
      return store.strings.has(key) ? store.strings.get(key) : null;
    }
    case 'SET': {
      const [key, value, ...opts] = rest;
      if (opts.includes('NX') && store.strings.has(key)) return null;
      store.strings.set(key, value);
      const exIdx = opts.indexOf('EX');
      if (exIdx !== -1) store.ttl.set(key, Number(opts[exIdx + 1]));
      return 'OK';
    }
    case 'DEL': {
      let n = 0;
      for (const key of rest) {
        const had = anyBucketHas(store, key);
        store.strings.delete(key);
        store.zsets.delete(key);
        store.hashes.delete(key);
        store.lists.delete(key);
        store.ttl.delete(key);
        if (had) n += 1;
      }
      return n;
    }
    case 'EXISTS': {
      const [key] = rest;
      return anyBucketHas(store, key) ? 1 : 0;
    }
    case 'EXPIRE': {
      const [key, secs] = rest;
      store.ttl.set(key, Number(secs));
      return 1;
    }
    case 'INCR': {
      const [key] = rest;
      const next = Number(store.strings.get(key) || '0') + 1;
      store.strings.set(key, String(next));
      return next;
    }
    case 'ZADD': {
      const [key, score, member] = rest;
      if (!store.zsets.has(key)) store.zsets.set(key, new Map());
      store.zsets.get(key).set(member, Number(score));
      return 1;
    }
    case 'ZREMRANGEBYRANK': {
      const [key, start, stop] = rest;
      const zset = store.zsets.get(key);
      if (!zset || !zset.size) return 0;
      const sorted = [...zset.entries()].sort((a, b) => a[1] - b[1]);
      const [lo, hi] = normRange(sorted.length, start, stop);
      let removed = 0;
      for (let i = lo; i <= hi; i += 1) {
        zset.delete(sorted[i][0]);
        removed += 1;
      }
      return removed;
    }
    case 'ZRANGEBYSCORE': {
      const [key, minRaw, maxRaw] = rest;
      const zset = store.zsets.get(key);
      if (!zset) return [];
      const lo = parseScoreBound(minRaw);
      const hi = parseScoreBound(maxRaw);
      return [...zset.entries()]
        .filter(
          ([, score]) =>
            (lo.exclusive ? score > lo.value : score >= lo.value) &&
            (hi.exclusive ? score < hi.value : score <= hi.value),
        )
        .sort((a, b) => a[1] - b[1])
        .map(([member]) => member);
    }
    case 'HSET': {
      const [key, field, value] = rest;
      if (!store.hashes.has(key)) store.hashes.set(key, new Map());
      store.hashes.get(key).set(field, value);
      return 1;
    }
    case 'HDEL': {
      const [key, field] = rest;
      const h = store.hashes.get(key);
      if (!h) return 0;
      return h.delete(field) ? 1 : 0;
    }
    case 'HGETALL': {
      const [key] = rest;
      const h = store.hashes.get(key);
      if (!h) return [];
      const flat = [];
      for (const [f, v] of h) flat.push(f, v);
      return flat;
    }
    case 'LPUSH': {
      const [key, ...values] = rest;
      if (!store.lists.has(key)) store.lists.set(key, []);
      const list = store.lists.get(key);
      // Real LPUSH pushes its arguments left-to-right, each new head pushing
      // the last one down — `LPUSH k v1 v2` leaves the list `[v2, v1, ...]`.
      for (const v of values) list.unshift(v);
      return list.length;
    }
    case 'LTRIM': {
      const [key, start, stop] = rest;
      const list = store.lists.get(key);
      if (!list) return 'OK';
      const [lo, hi] = normRange(list.length, start, stop);
      store.lists.set(key, hi < lo ? [] : list.slice(lo, hi + 1));
      return 'OK';
    }
    case 'LRANGE': {
      const [key, start, stop] = rest;
      const list = store.lists.get(key) || [];
      const [lo, hi] = normRange(list.length, start, stop);
      return hi < lo ? [] : list.slice(lo, hi + 1);
    }
    case 'LLEN': {
      const [key] = rest;
      return (store.lists.get(key) || []).length;
    }
    case 'PING':
      return 'PONG';
    case 'EVAL': {
      const [script, numkeysRaw, ...tail] = rest;
      const numkeys = Number(numkeysRaw);
      const keys = tail.slice(0, numkeys);
      const args = tail.slice(numkeys);
      const handler = evalScripts?.get(script);
      if (!handler) {
        throw new Error('fakeUpstash: EVAL of an unregistered script — register it in createFakeUpstash({ evalScripts })');
      }
      return handler(store, keys, args);
    }
    default:
      throw new Error(`fakeUpstash: unsupported command ${op}`);
  }
}

/**
 * @param {Record<string, (store, keys, args) => unknown>} evalScripts
 *   Map of exact Lua script text -> a JS function implementing it against
 *   this fake's store. Pass the real exported script constants as keys so a
 *   test proves the module under test is sending the script it claims to.
 */
export function createFakeUpstash({ evalScripts = {} } = {}) {
  const store = createStore();
  const evalMap = new Map(Object.entries(evalScripts));
  const calls = [];

  const fetchImpl = async (url, opts) => {
    const isPipeline = String(url).endsWith('/pipeline');
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), headers: opts.headers, body });
    if (isPipeline) {
      const rows = body.map((cmd) => {
        try {
          return { result: execCommand(store, cmd, evalMap) };
        } catch (err) {
          return { error: String(err?.message || err) };
        }
      });
      return { ok: true, status: 200, json: async () => rows };
    }
    try {
      const result = execCommand(store, body, evalMap);
      return { ok: true, status: 200, json: async () => ({ result }) };
    } catch (err) {
      return { ok: false, status: 500, json: async () => ({ error: String(err?.message || err) }) };
    }
  };

  return { fetchImpl, store, calls };
}
