// Party storage.
//
// Two backends. If UPSTASH_REDIS_REST_URL / _TOKEN are set we use Upstash over
// REST, which survives restarts and works on serverless. Otherwise we fall back
// to a module-level Map, which is fine for `npm run dev` or a single long-lived
// Node process and resets whenever that process does.

const TTL_SECONDS = 8 * 60 * 60;

const URL_BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
export const usingRedis = Boolean(URL_BASE && TOKEN);

const memory = globalThis.__kiParties ?? (globalThis.__kiParties = new Map());

async function redis(command) {
  const res = await fetch(URL_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const data = await res.json();
  return data.result;
}

const key = (code) => `ki:party:${code}`;

function prune(party) {
  const cutoff = Date.now() - 45 * 60 * 1000;
  for (const [id, m] of Object.entries(party.members)) {
    if (m.ts < cutoff) delete party.members[id];
  }
  return party;
}

export async function readParty(code) {
  if (usingRedis) {
    const raw = await redis(['GET', key(code)]);
    return raw ? prune(JSON.parse(raw)) : null;
  }
  const party = memory.get(code);
  if (!party) return null;
  if (Date.now() - party.created > TTL_SECONDS * 1000) {
    memory.delete(code);
    return null;
  }
  return prune(party);
}

export async function writeParty(code, party) {
  if (usingRedis) {
    await redis(['SET', key(code), JSON.stringify(party), 'EX', String(TTL_SECONDS)]);
    return party;
  }
  memory.set(code, party);
  return party;
}

export async function deleteParty(code) {
  if (usingRedis) await redis(['DEL', key(code)]);
  else memory.delete(code);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

export function makeCode(length = 5) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export async function createParty() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeCode();
    if (!(await readParty(code))) {
      const party = { code, created: Date.now(), members: {}, meet: null };
      await writeParty(code, party);
      return party;
    }
  }
  throw new Error('Could not allocate a party code');
}

export const normaliseCode = (raw) =>
  String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
