/**
 * In-memory `/api/mailbox` and `/api/health` for Node WebRTC tests.
 *
 * Routes fetch through the real serverStore memory backend so signaling
 * exercises the same append/read semantics the production API uses.
 */

const APP = new URL('../../../apps/party-tracker/', import.meta.url);

/** @type {typeof import('../../../apps/party-tracker/lib/serverStore.js')} */
let store;

async function loadStore() {
  if (store) return store;
  for (const name of [
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
  ]) {
    delete process.env[name];
  }
  store = await import(new URL('lib/serverStore.js', APP).href);
  return store;
}

function jsonResponse(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
  };
}

/**
 * @param {{ base?: string, fetch?: typeof fetch }} [opts]
 * @returns {Promise<{ base: string, restore: () => void, posts: Array<object> }>}
 */
export async function installMailboxFetch({ base = 'https://party.test', fetch: prevFetch } = {}) {
  const root = base.replace(/\/+$/, '');
  const prior = prevFetch ?? globalThis.fetch;
  const posts = [];
  const mod = await loadStore();

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u === `${root}/api/health`) return jsonResponse({ ok: true });

    const mailbox = u.match(new RegExp(`^${root}/api/mailbox/([^?]+)`));
    if (!mailbox) return prior(url, opts);

    const partyId = decodeURIComponent(mailbox[1]);
    if (opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push({ partyId, ...body });
      const seq = await mod.appendMailbox(partyId, {
        from: body.from,
        to: body.to ?? '*',
        kind: body.kind,
        data: body.data,
      });
      return jsonResponse({ ok: true, seq });
    }

    const params = new URL(u).searchParams;
    const peer = decodeURIComponent(params.get('for') || '');
    const since = Number(params.get('since') ?? 0);
    const { messages, seq } = await mod.readMailbox(partyId, since);
    const mine = messages
      .filter((m) => m.from !== peer && (m.to === '*' || m.to === peer))
      .map(({ seq: s, from, to, kind, data }) => ({ seq: s, from, to, kind, data }));
    return jsonResponse({ messages: mine, cursor: Math.max(since, seq) });
  };

  return {
    base: root,
    posts,
    restore: () => {
      globalThis.fetch = prior;
    },
  };
}

/** Browser globals mailbox polling expects. */
export function installBrowserGlobals() {
  const priorDoc = globalThis.document;
  globalThis.document = {
    visibilityState: 'visible',
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return {
    restore: () => {
      globalThis.document = priorDoc;
    },
  };
}
