/*
 * The phone's half of the notifications.
 *
 * Two jobs. Getting permission and a subscription, which happens once and only
 * at a moment where asking makes sense; and handing the service worker the
 * party key, because the worker is what will be awake when the push lands and
 * the page is not.
 *
 * The key goes into IndexedDB rather than being passed in a message: a push
 * wakes the worker in a fresh execution context with no page attached, so
 * anything it needs has to already be on disk.
 */
import { b64urlDecode, importKey, open, seal } from '@/lib/core/crypto';

const DB = 'tracker-push';
const STORE = 'party';
const ROW = 'current';

/** What the user has asked to be told about. Defaults on, minus the noisy one. */
export const KINDS = {
  help: { label: 'Someone needs help', hint: 'Buzzes even when the phone is locked.', on: true },
  join: { label: 'Someone joins or leaves', hint: 'So you know the invite worked.', on: true },
  meet: { label: 'The Rally Point moves', hint: 'When somebody sets or changes it.', on: true },
  quiet: {
    label: 'Someone goes quiet',
    hint: 'No word for a while. Queue buildings eat signal, so this one cries wolf.',
    on: false,
  },
};

export const defaultPrefs = () =>
  Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.on]));

/* ------------------------------------------------------------ the key store */

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(value) {
  const db = await idb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, ROW);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Tell the worker which party it is listening for and how to read it. Called on
 * every party change; called with null on leaving, which is what stops a push
 * from a party you have left being readable on this phone.
 */
export async function rememberParty(party, prefs = null) {
  if (typeof indexedDB === 'undefined') return;
  try {
    await put(
      party?.partyId && party?.keyString
        ? {
            partyId: party.partyId,
            keyString: party.keyString,
            selfId: party.selfId || null,
            // Which kinds this phone's owner asked for. The worker is what
            // decides whether to show one, and it runs with no page attached,
            // so the answer has to be on disk beside the key.
            prefs: prefs || defaultPrefs(),
          }
        : null,
    );
  } catch {
    /* private mode, or a browser refusing storage: notifications degrade to
       the generic wording rather than failing */
  }
}

/* ----------------------------------------------------------- subscribing */

/* Whether this deployment has notification keys at all, asked once. A build
   with none is the normal case for a checkout and a dev server, and the app
   has to behave as though the whole feature is absent rather than throwing a
   failed request every time somebody changes the meet-up. */
let configuredPromise = null;
export function configured() {
  if (!configuredPromise) {
    configuredPromise = fetch('/api/push/key')
      .then((r) => r.json())
      .then((j) => (j?.enabled && j.key ? j.key : null))
      .catch(() => null);
  }
  return configuredPromise;
}

export const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/**
 * iOS only hands out push to a PWA that has been added to the Home Screen, and
 * says nothing useful if you ask from a tab — so the UI has to know, and say so,
 * rather than showing a button that silently does nothing.
 */
export const iosNeedsInstall = () => {
  if (typeof window === 'undefined') return false;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  const installed = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone;
  return ios && !installed;
};

export const permission = () => (supported() ? Notification.permission : 'unsupported');

/**
 * Ask, subscribe, and register the subscription against this party.
 * @returns 'granted' | 'denied' | 'unsupported' | 'unconfigured' | 'failed'
 */
export async function enable({ partyId, memberId }) {
  if (!supported()) return 'unsupported';

  const serverKey = await configured();
  if (!serverKey) return 'unconfigured';

  const granted = await Notification.requestPermission();
  if (granted !== 'granted') return 'denied';

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        // Required by Chrome, and honest: every push this app sends is one a
        // person is meant to see.
        userVisibleOnly: true,
        applicationServerKey: b64urlDecode(serverKey),
      }));
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partyId, memberId, subscription: sub.toJSON() }),
    });
    return 'granted';
  } catch {
    return 'failed';
  }
}

/** Hand back the right to wake this phone for this party. */
export async function disable(partyId) {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partyId, endpoint: sub.endpoint }),
    });
  } catch {
    /* nothing to hand back */
  }
}

/* -------------------------------------------------------------- sending */

/**
 * Seal a notification with the party key and hand it to the relay.
 *
 * `note` is `{ kind, title, body, focus }` — `focus` is what tapping it should
 * open, in the same shape the glance rail uses for navigation targets.
 */
export async function notify({ partyId, keyString, from, note, urgent = false }) {
  if (!partyId || !keyString) return;
  // Nothing to send to, and no reason to make a request that will only fail.
  if (!(await configured())) return;
  try {
    const key = await importKey(keyString);
    const sealed = await seal(key, partyId, note);
    await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partyId, from, sealed, urgent }),
    });
  } catch {
    /* a notification that cannot be sent is not worth taking the app down for */
  }
}

export { open as openSealed };
