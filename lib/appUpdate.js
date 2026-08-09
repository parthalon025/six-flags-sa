/**
 * Keep the installed shell current when the phone can reach the server, and
 * stay on the last good build when it cannot.
 *
 * Two layers:
 *   1. `/api/version` — is the JavaScript bundle behind?
 *   2. `navigator.serviceWorker` — is the offline shell behind?
 *
 * Both are probed with short timeouts and no thrown errors: a queue line with no
 * signal should not surface a failure toast.
 */

import { APP_VERSION, isNewerVersion } from './version.js';

const VERSION_URL = '/api/version';
const CHECK_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const RELOAD_GUARD_KEY = 'tracker-update-reload';
const RELOAD_ATTEMPTS_KEY = 'tracker-update-attempts';
const MAX_RELOAD_ATTEMPTS = 1;

/** @typedef {'idle' | 'checking' | 'current' | 'update-available' | 'updating' | 'offline'} UpdateStatus */

/**
 * @returns {Promise<{ version: string, protocol?: number } | null>}
 */
export async function fetchServerVersion({ signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(VERSION_URL, {
      cache: 'no-store',
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || typeof body.version !== 'string') return null;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Ask the browser to look for a new service worker script.
 * @param {ServiceWorkerRegistration | null | undefined} reg
 */
export async function probeServiceWorker(reg) {
  if (!reg) return;
  try {
    await reg.update();
  } catch {
    /* offline or the host is down */
  }
}

/**
 * Move a waiting worker to active and reload once it takes control.
 * @param {ServiceWorkerRegistration} reg
 */
export function activateWaitingWorker(reg) {
  const waiting = reg.waiting;
  if (!waiting) return false;
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
  } catch {
    /* private mode */
  }
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

/**
 * Register for the one reload after a new worker claims the page.
 * @param {() => void} reload
 */
export function onControllerChange(reload) {
  let reloaded = false;
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY) === '1') {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
      reloaded = true;
      reload();
      return () => {};
    }
  } catch {
    /* fall through */
  }

  const handler = () => {
    if (reloaded) return;
    reloaded = true;
    try {
      sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
    } catch {
      /* */
    }
    reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', handler);
  return () => navigator.serviceWorker.removeEventListener('controllerchange', handler);
}

/**
 * Wire service-worker lifecycle hooks.
 * @param {{
 *   onStatus?: (status: UpdateStatus, detail?: object) => void,
 *   reload?: () => void,
 * }} opts
 * @returns {Promise<() => void>}
 */
export async function watchAppUpdates({ onStatus, reload = () => window.location.reload() } = {}) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    onStatus?.('idle');
    return () => {};
  }

  let reg = null;
  try {
    reg = await navigator.serviceWorker.register('/sw.js');
  } catch {
    onStatus?.('offline');
    return () => {};
  }

  const cleanups = [];
  cleanups.push(onControllerChange(reload));

  const consider = () => {
    if (reg.waiting && navigator.serviceWorker.controller) {
      onStatus?.('update-available', { source: 'service-worker' });
      onStatus?.('updating', { source: 'service-worker' });
      activateWaitingWorker(reg);
      return;
    }
    if (reg.installing) {
      onStatus?.('updating', { source: 'service-worker' });
    }
  };

  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') consider();
    });
  });
  consider();

  let remoteVersion = null;
  let checkTimer = null;
  let online = typeof navigator.onLine === 'boolean' ? navigator.onLine : true;

  const runCheck = async () => {
    if (!online) {
      onStatus?.('offline', { local: APP_VERSION });
      return;
    }
    onStatus?.('checking');
    const remote = await fetchServerVersion();
    if (!remote) {
      onStatus?.('offline', { local: APP_VERSION });
      return;
    }
    remoteVersion = remote.version;
    if (isNewerVersion(remote.version, APP_VERSION)) {
      onStatus?.('update-available', { local: APP_VERSION, remote: remote.version });
      onStatus?.('updating', { local: APP_VERSION, remote: remote.version });
      await probeServiceWorker(reg);
      consider();
      if (!reg.waiting) {
        // Bundle is ahead but the worker has not caught up yet — a hard reload
        // is the honest fallback once we know the network is there.
        try {
          sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
        } catch {
          /* */
        }
        reload();
      }
      return;
    }
    await probeServiceWorker(reg);
    consider();
    onStatus?.('current', { local: APP_VERSION, remote: remote.version });
  };

  const onOnline = () => {
    online = true;
    runCheck();
  };
  const onOffline = () => {
    online = false;
    onStatus?.('offline', { local: APP_VERSION, remote: remoteVersion });
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  cleanups.push(() => window.removeEventListener('online', onOnline));
  cleanups.push(() => window.removeEventListener('offline', onOffline));

  checkTimer = setInterval(runCheck, CHECK_MS);
  cleanups.push(() => clearInterval(checkTimer));

  const onVisible = () => {
    if (document.visibilityState === 'visible') runCheck();
  };
  document.addEventListener('visibilitychange', onVisible);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisible));

  runCheck();

  return () => {
    for (const fn of cleanups) fn();
  };
}
