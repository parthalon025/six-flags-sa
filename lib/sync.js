'use client';

/**
 * One sync client, two possible backends.
 *
 *   NEXT_PUBLIC_SYNC_URL unset  -> same-origin Next.js /api/party routes (polling)
 *   NEXT_PUBLIC_SYNC_URL set    -> the standalone server in /server (SSE push)
 *
 * The wire protocol is identical either way, so nothing above this file cares.
 */

export const SYNC_BASE = (process.env.NEXT_PUBLIC_SYNC_URL || '').replace(/\/$/, '');
export const SUPPORTS_STREAM = Boolean(SYNC_BASE);

const url = (p) => `${SYNC_BASE}${p}`;

async function req(path, options = {}) {
  const res = await fetch(url(path), {
    cache: 'no-store',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`sync ${res.status}`);
  return res.json();
}

export const createParty = () => req('/api/party', { method: 'POST' });

export const fetchParty = (code) => req(`/api/party/${code}`);

export const putMember = (code, member) =>
  req(`/api/party/${code}`, { method: 'PUT', body: JSON.stringify(member) });

export const removeMember = (code, id) =>
  req(`/api/party/${code}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });

export const putMeet = (code, meet) =>
  req(`/api/party/${code}/meet`, { method: 'PUT', body: JSON.stringify(meet) });

export const clearMeet = (code) => req(`/api/party/${code}/meet`, { method: 'DELETE' });

/**
 * Subscribe to a party. Uses the server-sent event stream when a standalone
 * sync server is configured, otherwise falls back to polling. Returns an
 * unsubscribe function either way.
 */
export function subscribe(code, onSnapshot, onTransport) {
  let stopped = false;

  const poll = () => {
    onTransport?.('polling');
    const tick = async () => {
      if (stopped) return;
      try {
        const data = await fetchParty(code);
        if (!stopped && data && !data.notFound) onSnapshot(data);
        if (data?.notFound) onSnapshot({ gone: true });
      } catch {
        /* try again next tick */
      }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => clearInterval(id);
  };

  if (!SUPPORTS_STREAM || typeof EventSource === 'undefined') {
    const stop = poll();
    return () => {
      stopped = true;
      stop();
    };
  }

  let stopPoll = null;
  const source = new EventSource(url(`/api/party/${code}/stream`));

  source.onopen = () => {
    onTransport?.('stream');
    if (stopPoll) {
      stopPoll();
      stopPoll = null;
    }
  };
  source.onmessage = (e) => {
    if (stopped) return;
    try {
      onSnapshot(JSON.parse(e.data));
    } catch {
      /* ignore malformed frame */
    }
  };
  source.onerror = () => {
    // EventSource retries on its own; back it with polling so the roster still
    // moves if the stream is being eaten by a proxy.
    if (!stopPoll && !stopped) stopPoll = poll();
  };

  return () => {
    stopped = true;
    source.close();
    if (stopPoll) stopPoll();
  };
}
