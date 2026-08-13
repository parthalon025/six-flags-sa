'use client';

/**
 * The single seam between React and the networking stack.
 *
 * Everything below this file is framework-agnostic and canonical; everything
 * above it is a component tree. The runtime owns exactly the things neither of
 * them should: which transports exist, which half of the protocol this device
 * is running, and how one turns into the other when the host walks off.
 *
 * It deliberately exposes no React: the page subscribes with three callbacks
 * and reads an immutable snapshot. That is what makes host migration invisible
 * — the party id, the code and the roster survive the swap, so there is no
 * moment where the UI can render a "you left the party" state.
 *
 * On the key. The party key is 256 random bits, minted at creation and never
 * derived from anything a relay can see. It reaches the other phones in the QR
 * and in the invite link's fragment, which browsers do not send to a server.
 *
 * A six-character code still has to be enough to join, because reading a
 * 256-bit key aloud in a queue is not a thing anyone will do — but the code is
 * spent on a handshake rather than on the key itself. See the handshake section
 * below for what that costs an attacker and what it does not.
 */

import { createHostService } from '@/lib/party/hostService';
import { createClient } from '@/lib/party/client';
import { createTransportManager } from '@/lib/transport/registry';
import { createLocalHttp } from '@/lib/transport/localHttp';
import { createWebRTC } from '@/lib/transport/webrtc';
import { createBluetooth } from '@/lib/transport/bluetooth';
import { createCloudRelay } from '@/lib/transport/cloudRelay';
import { createOfflineQueue } from '@/lib/transport/offlineQueue';
import { AnalyticsEvents } from '@/lib/analytics';
import {
  b64urlDecode,
  b64urlEncode,
  exportKey,
  generateKey,
  importKey,
  open,
  seal,
} from '@/lib/core/crypto';
import { newMemberId, newPartyCode, normalizeCode } from '@/lib/core/ids';
import {
  CLAIM,
  HEARTBEAT,
  LOCATION,
  PATCH_MEMBER,
  PING,
  SET_MEET,
  SET_PLAN,
  ADD_MEMBER,
  REMOVE_MEMBER,
  SET_RIDE_STATUS,
  SET_TARGET,
  VICTORY,
} from '@/lib/core/protocol';
import { readRank, shouldYield } from '@/lib/party/election';
import {
  clearSession,
  createSession,
  decodeInvite,
  encodeInvite,
  isLiveSession,
  loadSession,
  persistLiveSession,
} from '@/lib/core/session';
import { adoptSnapshot } from '@/lib/core/state';
import { effectiveShareMode, locationForShare, shareModePatch } from '@/lib/gps/sharing';

/** The self-hosted Node host in /server, when one is configured. */
const LAN_BASE = (process.env.NEXT_PUBLIC_SYNC_URL || '').replace(/\/+$/, '');

/**
 * Where /join parks an invite for the map page to open. Session storage, not
 * local: an invite is consumed once, by the tab that was handed the link.
 */
export const PENDING_INVITE_KEY = 'ki-pending-invite';

/** Read and clear the invite /join left behind, if there is one.
 *  Payload shapes:
 *    - legacy string: raw invite hash or code
 *    - JSON `{ payload, name }`: invite plus optional display name from /join
 */
export function takePendingInvite() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_INVITE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_INVITE_KEY);
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.payload) {
        return {
          payload: String(parsed.payload),
          name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
        };
      }
    } catch {
      /* legacy bare string */
    }
    return { payload: raw, name: '' };
  } catch {
    return null;
  }
}

/** Stash an invite for the map page to open once (optionally with a name). */
export function stashPendingInvite(payload, name = '') {
  if (typeof window === 'undefined' || !payload) return false;
  try {
    window.sessionStorage.setItem(
      PENDING_INVITE_KEY,
      JSON.stringify({ payload: String(payload), name: String(name || '').trim() }),
    );
    return true;
  } catch {
    return false;
  }
}

const origin = () => (typeof window === 'undefined' ? '' : window.location.origin);

const noop = () => {};

/** Longest a deliberate leave will wait for its goodbye to reach the wire. */
const ANNOUNCE_TIMEOUT_MS = 3000;

/**
 * Resolve when `work` does, or when the clock runs out — never later, and never
 * by rejecting. Teardown uses it so a transport that has already died cannot
 * hold the UI in a state the visitor has finished with.
 */
function bounded(work, ms = ANNOUNCE_TIMEOUT_MS) {
  if (!work?.then) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    Promise.resolve(work)
      .catch(() => null)
      .then(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

export function createPartyRuntime({ onState = noop, onStatus = noop, onToast = noop } = {}) {
  let session = null;
  let key = null;
  let manager = null;
  let link = null;
  let host = null; // createHostService, when this device is serving
  let client = null; // createClient, when it is not
  let outbox = null; // the offline queue, kept for its depth counter
  let phase = 'idle'; // idle | connecting | live | error
  let error = null;
  let destroyed = false;
  const statuses = new Map(); // transport name -> last status event

  /** Whichever half of the protocol is live. Migration swaps this atomically. */
  const service = () => host || client || null;
  const partyState = () => service()?.getState?.() ?? null;

  function persistSession() {
    if (!session) return;
    session.live = true;
    persistLiveSession(session);
  }

  /* ------------------------------------------------------------ snapshot -- */

  function inviteUrl() {
    // No key yet means a code-join mid-handshake: an invite without one is not
    // an invite, and offering it would hand out a link nobody can open.
    if (!session?.keyString) return null;
    try {
      return encodeInvite(session, { origin: origin() });
    } catch {
      return null;
    }
  }

  function getSnapshot() {
    const state = partyState();
    return {
      phase,
      error,
      // A session exists from the moment a join starts, but a code-join then
      // spends the whole handshake without a service to run commands through,
      // and `submit` drops anything offered in that window. "Active" therefore
      // means "there is a party layer that will accept a command", not merely
      // "we are attached to a party id" — otherwise the first location a phone
      // ever produces is thrown away, and the broadcast gate, having recorded
      // it as sent, does not offer another until the phone moves.
      active: Boolean(session && service()),
      hosting: Boolean(host),
      role: host ? 'host' : client ? 'client' : null,
      partyId: session?.partyId ?? null,
      code: session?.code ?? null,
      selfId: session?.selfId ?? null,
      hostId: state?.leader ?? session?.hostId ?? null,
      name: session?.memberName ?? 'Guest',
      invite: inviteUrl(),
      // The party key, for the parts of the app that have to seal something
      // themselves — the notification path, which has to hand the service
      // worker a key it can use while no page is running. No new exposure: the
      // invite URL directly above carries the same key in its fragment.
      keyString: session?.keyString ?? null,
      version: state?.version ?? 0,
      members: state ? Object.values(state.members) : [],
      // Ride reports, keyed by ride id. Handed over as the raw map rather than
      // a list because every reader looks one ride up at a time.
      rides: state?.rides ?? {},
      meet: state?.meet ?? null,
      plan: state?.plan ?? [],
      transport: activeName(),
      queued: queued(),
      // When this host stops answering key-requests, as a timestamp. 0 when
      // it is not answering now. Only a host has one.
      joinsOpenUntil: host && keyWindow && Date.now() < keyWindow.until ? keyWindow.until : 0,
    };
  }

  function activeName() {
    try {
      return manager?.activeName?.() ?? null;
    } catch {
      return null;
    }
  }

  function queued() {
    try {
      return outbox?.size?.() ?? 0;
    } catch {
      return 0;
    }
  }

  function emit() {
    if (destroyed) return;
    try {
      onState(getSnapshot());
    } catch {
      /* a listener that throws must not take the party down */
    }
  }

  function say(message) {
    if (!message || destroyed) return;
    try {
      onToast(String(message));
    } catch {
      /* as above */
    }
  }

  /* ---------------------------------------------------------------- key --- */

  /**
   * The handshake key — never the party key.
   *
   * A code is six characters from a 32-symbol alphabet: about 30 bits, which is
   * minutes of offline work. A key of that strength cannot hold a party's
   * traffic, so it holds exactly one exchange (see the handshake section).
   *
   * Binding it to the party id as well as the code means a recycled code (they
   * expire and are reissued) never reproduces an older party's handshake key.
   */
  async function deriveHandshakeKey(partyId, code) {
    const seed = new TextEncoder().encode(`ki-handshake-v1|${partyId}|${normalizeCode(code)}`);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', seed);
    return b64urlEncode(new Uint8Array(digest));
  }

  /** 256 bits, base64url. Anything else is not this party's key. */
  async function usableKeyString(str) {
    try {
      if (typeof str !== 'string' || b64urlDecode(str).length !== 32) return false;
      await importKey(str);
      return true;
    } catch {
      return false;
    }
  }

  /* ---------------------------------------------------------- handshake --- */

  /**
   * Join by typed code, without the code becoming the party's secrecy.
   *
   * QR and link joins carry the real key and need none of this. A typed code
   * cannot carry 256 bits, so a code-only joiner asks for them: KEY_REQUEST
   * sealed under `deriveHandshakeKey(partyId, code)`, and the host — the only
   * peer holding both the code and the real key — answers with KEY_GRANT sealed
   * under the same. Every frame after that is sealed under the strong key.
   *
   * What this buys, precisely. Before, the party key *was* the derived one, so a
   * relay operator holding any single captured frame could grind 32^6 codes
   * offline and read the party's whole history and future. Now the code protects
   * one exchange: an attacker must have been recording at the moment somebody
   * joined by code *and* spend the same grind, for a key that a party with no
   * code-joins never puts on the wire at all.
   *
   * What it does not buy: anyone who legitimately learns the code can still ask
   * for the key while the window is open. A code is a join credential, not a
   * secret worth more than that.
   */
  const HANDSHAKE_VERSION = 1;
  const KEY_REQUEST = 'key-request';
  const KEY_GRANT = 'key-grant';

  /**
   * How long a host answers key-requests for: opened when this device starts
   * hosting, and by `allowJoins()` for a UI that puts the code back on screen.
   * Outside the window a brute-forced code buys nothing, because there is
   * nobody left to ask.
   */
  const KEY_WINDOW_MS =
    Number(globalThis.__PARTY_KEY_WINDOW_MS) || 10 * 60 * 1000;
  /** Per joiner, per window. The joiner re-asks until the grant lands, so > 1. */
  const MAX_GRANTS_PER_PEER = 3;
  /** A code-join gives up rather than sitting in a party it cannot read. */
  const KEY_WAIT_MS = 25000;
  const KEY_RETRY_MS = 2000;

  let keyWindow = null; // host side: { key, until, grants: Map<peerId, count> }
  let keySeeker = null; // joiner side: { key, selfId, accept, cancel }

  async function openKeyWindow() {
    if (!session?.code || !session?.keyString) return;
    const partyId = session.partyId;
    const derived = await deriveHandshakeKey(partyId, session.code);
    const key = await importKey(derived);
    // The party may have been torn down while that resolved.
    if (destroyed || session?.partyId !== partyId) return;
    keyWindow = { key, until: Date.now() + KEY_WINDOW_MS, grants: new Map() };
    // The window is a thing the host has to be told about — a code that has
    // quietly stopped working is the failure this whole section exists to
    // avoid — so opening it is a state change like any other.
    emit();
  }

  function keyWindowOpen() {
    if (!keyWindow) return false;
    if (Date.now() > keyWindow.until) {
      keyWindow = null;
      return false;
    }
    return true;
  }

  /** Reopen the window. For a UI that has the join sheet or the code on screen. */
  function allowJoins() {
    if (host) openKeyWindow().catch(() => null);
  }

  async function answerKeyRequest(f) {
    const peer = typeof f.from === 'string' ? f.from.slice(0, 64) : '';
    if (!peer || peer === session.selfId) return;
    const used = keyWindow.grants.get(peer) || 0;
    if (used >= MAX_GRANTS_PER_PEER) return; // a peer that keeps asking is not asking
    keyWindow.grants.set(peer, used + 1);
    const sealed = await seal(keyWindow.key, session.partyId, {
      hs: HANDSHAKE_VERSION,
      kind: KEY_GRANT,
      from: session.selfId,
      to: peer,
      key: session.keyString,
      ts: Date.now(),
    });
    await link?.send(sealed);
  }

  /** Ask, and keep asking, until the host answers or the wait runs out. */
  function requestPartyKey(code) {
    const partyId = session.partyId;
    const selfId = session.selfId;
    return new Promise((resolve, reject) => {
      let retry = null;
      let deadline = null;
      const finish = (settle, value) => {
        if (retry != null) clearInterval(retry);
        if (deadline != null) clearTimeout(deadline);
        keySeeker = null;
        settle(value);
      };
      deriveHandshakeKey(partyId, code)
        .then(importKey)
        .then((handshakeKey) => {
          // Torn down while that resolved: nothing left to ask on.
          if (destroyed || session?.partyId !== partyId) {
            finish(reject, new Error('Join cancelled.'));
            return;
          }
          keySeeker = {
            key: handshakeKey,
            selfId,
            accept: (keyString) => finish(resolve, keyString),
            cancel: () => finish(reject, new Error('Join cancelled.')),
          };
          const ask = () =>
            seal(handshakeKey, partyId, {
              hs: HANDSHAKE_VERSION,
              kind: KEY_REQUEST,
              from: selfId,
              ts: Date.now(),
            })
              .then((sealed) => link?.send(sealed))
              .catch(() => null);
          ask();
          retry = setInterval(ask, KEY_RETRY_MS);
          deadline = setTimeout(
            () =>
              finish(
                reject,
                new Error('That party did not answer. Ask for the QR code or the invite link.'),
              ),
            KEY_WAIT_MS,
          );
        })
        .catch((err) => finish(reject, err));
    });
  }

  /**
   * @returns true when the envelope was handshake traffic and is now dealt with.
   *
   * Handshake frames carry no marker on the wire and are told apart by trial
   * decryption: a marker would point a relay operator at the one frame worth
   * grinding the code against. The cost is one extra AES-GCM attempt per inbound
   * envelope, and only while a window is open or a joiner is waiting.
   */
  async function handleHandshake(sealed) {
    const seeker = keySeeker;
    if (seeker) {
      const f = await open(seeker.key, sealed);
      if (!f) return false;
      if (f.hs === HANDSHAKE_VERSION && f.kind === KEY_GRANT && f.to === seeker.selfId) {
        if (await usableKeyString(f.key)) seeker.accept(f.key);
      }
      return true; // it opened under the handshake key, so it is not party traffic
    }
    if (keyWindowOpen()) {
      const f = await open(keyWindow.key, sealed);
      if (!f) return false;
      if (f.hs === HANDSHAKE_VERSION && f.kind === KEY_REQUEST) await answerKeyRequest(f);
      return true;
    }
    return false;
  }

  async function routeSealed(sealed) {
    try {
      if (await handleHandshake(sealed)) return;
    } catch {
      /* a handshake that misfires must not swallow party traffic */
    }
    service()?.handleSealed?.(sealed);
  }

  /* ---------------------------------------------------------- transport --- */

  /**
   * A facade over the manager, handed to the host service and the client in
   * place of the manager itself.
   *
   * Two things it fixes, both of which are race conditions rather than taste:
   * `connect()` is idempotent, so the client's `start()` cannot kick off a
   * second selection pass on top of the one already running; and `send()` waits
   * for that pass, so the first HELLO cannot be sent through a manager that has
   * not chosen a transport yet and end up driving a failover from nothing.
   *
   * `mute()` exists for teardown: a client's `stop()` always posts a BYE, which
   * is right when the user leaves and wrong when the tab is merely unmounting.
   */
  function createLink(mgr) {
    let opening = null;
    let pending = Promise.resolve();
    let muted = false;

    const connect = () => {
      if (!opening) {
        opening = Promise.resolve(mgr.connect()).catch((err) => {
          say('Trouble reaching the other phones — hold still for a moment.');
          return null;
        });
      }
      return opening;
    };

    return {
      connect,
      /**
       * Throw away the current selection and choose again from scratch.
       *
       * The memo above deliberately collapses repeated connects, so this needs
       * its own door. It exists for one situation the manager cannot detect on
       * its own: WebRTC is a star with the host at the centre, and a data
       * channel to a phone that has been switched off stays `open` for as long
       * as ICE takes to give up. Every send into it succeeds, so nothing ever
       * fails over — and the peers spend the entire election shouting down a
       * dead channel, hearing nothing, and each electing themselves. Losing the
       * host is the moment that path stops being worth anything, whatever the
       * socket still claims.
       */
      reselect() {
        if (muted) return Promise.resolve(null);
        opening = Promise.resolve(mgr.connect()).catch((err) => {
          say('Trouble reaching the other phones — hold still for a moment.');
          return null;
        });
        return opening;
      },
      async send(sealed) {
        if (muted) return { ok: false, queued: false, via: null };
        await connect();
        if (muted) return { ok: false, queued: false, via: null };
        const sending = mgr.send(sealed);
        pending = pending.then(() => sending).catch(() => null);
        return sending;
      },
      activeName: () => mgr.activeName(),
      stats: () => mgr.stats(),
      mute: () => {
        muted = true;
      },
      /**
       * Wait for anything in flight to actually leave. A frame handed to the
       * service a moment ago is still inside its own `seal()` and has not
       * reached this chain yet, so settling once is not enough.
       */
      async drain() {
        for (let i = 0; i < 3; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          await pending.catch(() => null);
        }
      },
    };
  }

  /**
   * Rank order is a property of the transports themselves (LOCAL_HTTP 10,
   * WEBRTC 20, BLUETOOTH 30, CLOUD_RELAY 40, OFFLINE 99); the manager sorts on
   * it. Listing them in the same order is for the reader.
   *
   * Worth knowing before reading a diagnostics panel in the field: the manager
   * runs exactly one transport at a time, and a WebRTC host with no peer yet
   * has no open data channel, so its first PING finds nobody on the direct
   * path and the manager moves on to the mailbox. The host warms that mailbox
   * in parallel now, and a joiner waits at most WebRTC's OPEN_TIMEOUT_MS
   * (four seconds) before the same relay takes over.
   */
  function buildTransports(role) {
    const lan = session.endpoints?.find(Boolean) || LAN_BASE;
    outbox = createOfflineQueue({ storageKey: `ki-outbox-${session.partyId}` });
    return [
      createLocalHttp({ base: lan }),
      createWebRTC({ base: origin(), role }),
      createBluetooth(),
      createCloudRelay({ base: origin() }),
      outbox,
    ];
  }

  function openManager(role) {
    manager = createTransportManager({
      transports: buildTransports(role),
      // The same object the transports read `hostId` and `role` off, and the
      // same one the runtime mutates as those facts change. Passing it by
      // reference is what lets a migration re-address WebRTC without a rebuild.
      session,
      onMessage: (sealed) => routeSealed(sealed),
      onStatus: (event) => {
        statuses.set(event.name, { ...event, at: Date.now() });
        try {
          onStatus(event);
        } catch {
          /* as above */
        }
        emit();
      },
    });
    link = createLink(manager);
  }

  /* --------------------------------------------------------------- host --- */

  /**
   * Move a snapshot into a freshly built host service.
   *
   * `createHostService` builds its own empty party and offers no seam for an
   * existing one, so the state object it is already holding is overwritten in
   * place — `reduce` reads that exact object on the next command, so this is
   * the seam whether or not it looks like one. Nothing has been sent yet at
   * this point: the service is constructed but not started.
   */
  function seedHost(svc, snapshot) {
    const state = svc.getState();
    Object.assign(state, adoptSnapshot(state, snapshot));
  }

  /** Floor between unprompted re-assertions, so a burst of claims is answered once. */
  const ASSERT_GAP_MS = 1500;
  let lastAssertAt = 0;

  function assertHost() {
    const at = Date.now();
    if (at - lastAssertAt < ASSERT_GAP_MS) return;
    lastAssertAt = at;
    host?.assert();
  }

  /**
   * Somebody else is campaigning, or already serving, while this phone hosts.
   *
   * Two peers can promote in the same instant — the claim windows overlap but
   * the transport underneath them is repairing itself, so neither hears the
   * other in time. That is survivable only if the pair can settle it afterwards
   * without a human, which means both sides applying the election's own total
   * order to the same two numbers. A promoted host carries the claim it won on;
   * every frame it sends that says "I am hosting" carries those numbers, so the
   * comparison is available to whichever of them hears the other first, and
   * both reach the same answer.
   *
   * The phone that started the party has no claim to compare, and does not need
   * one: it yields to any rival that says it is serving, exactly as before.
   */
  function reconcile(frame) {
    if (!host || !frame?.from || frame.from === session.selfId) return;
    // A VICTORY or a beacon is a peer asserting that it is hosting; a claim is
    // one about to. Nothing else says anything about who holds the party.
    if (frame.kind !== CLAIM && frame.kind !== VICTORY && frame.kind !== PING) return;

    // A claim is a peer that has not decided yet: answering it is what stops it
    // deciding wrong, and it never justifies standing down.
    if (frame.kind === CLAIM) {
      assertHost();
      return;
    }

    const mine = host.rank();
    if (!mine) {
      stepDown(frame.from, frame.body?.snapshot ?? null);
      return;
    }
    // Unscored is unbeatable: a peer that is serving and will not say what it
    // won on gets the benefit of the doubt, because one host too few repairs
    // itself in a timeout and one host too many never does.
    const theirs = readRank(frame, { score: Infinity, joinOrder: -1 });
    if (shouldYield({ ...mine, id: session.selfId }, theirs)) {
      stepDown(theirs.id, frame.body?.snapshot ?? null);
      return;
    }
    // We hold the better claim, so the other phone is the one that has to move.
    // The total order admits exactly one winner, so this cannot ping-pong.
    assertHost();
  }

  function wireHost() {
    host.on('change', emit);
    host.on('election', reconcile);
  }

  function startHost(snapshot, rank = null) {
    session.role = 'host';
    session.hostId = session.selfId;
    host = createHostService({ session, key, transport: link, rank });

    const adopted = snapshot && Number.isFinite(snapshot.version) && snapshot.version > 0;
    if (adopted) seedHost(host, snapshot);
    wireHost();
    host.start();
    // A migration must not leave the party's typed code dead, so the window
    // reopens for the phone that took over.
    openKeyWindow().catch(() => null);

    if (adopted) {
      // The replica was adopted verbatim, old leader and all, so taking
      // leadership now goes through the reducer and lands as a patch at exactly
      // `version + 1`. Every other replica applies it without a resync and
      // without ever seeing an empty roster — that is the whole trick of a
      // migration nobody notices.
      if (!host.getState().members[session.selfId]) {
        host.applyLocal({
          kind: 'join',
          from: session.selfId,
          body: { name: session.memberName || 'Guest', userId: session.userId || null },
        });
      }
      host.applyLocal({ kind: 'set-leader', body: { leader: session.selfId } });
      // Tell the previous Host we are serving so it can stand down. A yieldTo
      // on WELCOME/PING is how a joiner knew to promote; VICTORY is how the
      // old Host hears that the steal finished.
      host.assert();
    }
    persistSession();
  }

  /* ------------------------------------------------------------- client --- */

  function startClient(snapshot = null) {
    session.role = 'client';
    client = createClient({ session, key, transport: link, snapshot });
    client.on('change', (state) => {
      // Adopt the host's identity as it changes: WebRTC reads this off the
      // session the next time it opens, and the diagnostics panel shows it.
      if (state?.leader && state.leader !== session.hostId) {
        session.hostId = state.leader;
        persistSession();
      }
      emit();
    });
    client.on('host-lost', () => {
      // Whatever was carrying traffic was chosen to reach the host, and the
      // host is what has just gone. Choose again before the claim goes out, or
      // the election is held down a channel with nobody on the other end.
      link?.reselect();
    });
    client.on('promote', ({ snapshot, score, joinOrder }) =>
      promote(snapshot, { score, joinOrder }),
    );
    client.start();
    persistSession();
  }

  /* ---------------------------------------------------------- migration --- */

  /** Client -> host, keeping the party id, the code and the roster. */
  function promote(snapshot, rank = null) {
    if (!client || host || destroyed) return;
    const leaving = client;
    client = null;
    leaving.stop(); // timers and election off; its BYE is addressed to the host that just vanished
    startHost(snapshot, rank);
    emit();
  }

  /**
   * Host -> client, when somebody else has a better claim to it.
   *
   * The roster this phone was serving goes with it. Nothing here is treated as
   * truth any more — the new host's WELCOME replaces it within a round trip —
   * but handing it over is what keeps the party list on screen from blinking
   * empty in the seconds between the two.
   */
  function stepDown(newHostId, snapshot = null) {
    if (!host || destroyed) return;
    const leaving = host;
    const held = leaving.getState();
    host = null;
    leaving.stop();
    session.hostId = newHostId;
    const better =
      snapshot && Number(snapshot.version) >= Number(held?.version ?? -1) ? snapshot : held;
    startClient(better || null);
    emit();
  }

  /* ------------------------------------------------------------ lifecycle - */

  async function teardown({ announce = false } = {}) {
    keySeeker?.cancel();
    keyWindow = null;
    if (announce) {
      // Awaited rather than left to `stop()`'s own BYE: leaving has to have
      // reached the host before the transports come down, or the roster keeps
      // a ghost until the 45-minute TTL evicts it. Bounded, because the phone
      // being left behind is often the one with no signal, and a leave that
      // waits out a dead socket looks to the visitor like a frozen app.
      if (client) await bounded(client.leave());
      client?.stop();
      host?.stop();
      await bounded(link?.drain());
    } else {
      // Unmounting is not leaving. Muting first swallows the BYE that `stop()`
      // posts unconditionally, so closing a tab does not delete you from a
      // party you are about to reopen.
      link?.mute();
      client?.stop();
      host?.stop();
    }
    link?.mute();
    client = null;
    host = null;
    try {
      await manager?.close();
    } catch {
      /* closing a transport that never opened is not an error worth surfacing */
    }
    manager = null;
    link = null;
    outbox = null;
    statuses.clear();
    session = null;
    key = null;
    phase = 'idle';
  }

  /* --------------------------------------------------------------- join --- */

  /** Ask the cloud fallback for a party id and a code nobody else holds. */
  async function allocate(selfId, name) {
    try {
      const res = await fetch('/api/party/create', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, leader: selfId }),
      });
      if (!res.ok) throw new Error('Could not reach the party service. Check your signal.');
      const body = await res.json();
      if (!body?.partyId || !body?.code) throw new Error('create: bad response');
      return { ...body, registered: true };
    } catch {
      // Local-first: a party can start with no server at all. The code will not
      // resolve for anyone, so this party is invite-link only until it is
      // recreated somewhere with a reachable API.
      return { partyId: newMemberId(), code: newPartyCode(6), token: '', registered: false };
    }
  }

  /** Turn a six-character code into a party id, via the cloud fallback's index. */
  async function resolveCode(code, member) {
    const res = await fetch('/api/party/join', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, member }),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Could not reach the party service. Check your signal.');
    const body = await res.json();
    return body?.partyId || null;
  }

  async function begin(built, role, memberName, partyName, { handshakeCode = null, userId = null } = {}) {
    session = built;
    session.memberName = memberName || 'Guest';
    session.partyName = partyName || 'Party';
    session.userId = userId || session.userId || null;
    openManager(role);
    if (handshakeCode) {
      try {
        session.keyString = await requestPartyKey(handshakeCode);
      } catch (err) {
        // Half-open transports on a party we cannot read are worse than none.
        await teardown();
        throw err;
      }
    }
    key = await importKey(session.keyString);
    if (role === 'host') startHost(null);
    else startClient();
    phase = 'live';
    error = null;
    persistSession();
    emit();
    return getSnapshot();
  }

  async function createParty({ name = 'Party', memberName = 'Guest', userId = null } = {}) {
    await teardown();
    phase = 'connecting';
    emit();
    try {
      const selfId = newMemberId();
      const allocated = await allocate(selfId, name);
      // The real key: 256 random bits, from here into the QR and the invite
      // fragment. Nothing about it is recoverable from the party id or the code.
      const keyString = await exportKey(await generateKey());
      const built = createSession({
        partyId: allocated.partyId,
        code: allocated.code,
        keyString,
        token: allocated.token || '',
        endpoints: LAN_BASE ? [LAN_BASE] : [],
        selfId,
        role: 'host',
        hostId: selfId,
      });
      const snapshot = await begin(built, 'host', memberName, name, { userId });
      if (!allocated.registered) {
        say('No server reachable — share the link or QR, the code will not resolve');
      }
      AnalyticsEvents.partyCreated(allocated.partyId);
      return snapshot;
    } catch (err) {
      phase = 'error';
      error = String(err?.message || err);
      emit();
      throw err;
    }
  }

  /** Accepts a whole invite URL, a bare fragment, or a six-character code. */
  async function joinParty(input, { memberName = 'Guest', userId = null } = {}) {
    await teardown();
    phase = 'connecting';
    emit();
    try {
      const selfId = newMemberId();
      const invite = decodeInvite(String(input || ''));
      let bundle = invite;
      let handshakeCode = null;

      if (!bundle) {
        const code = normalizeCode(input);
        if (code.length !== 6) throw new Error('A party code is six characters.');
        const partyId = await resolveCode(code, { id: selfId, name: memberName });
        if (!partyId) throw new Error(`No party with code ${code}.`);
        // A typed code carries no key. `begin` runs the handshake for one.
        handshakeCode = code;
        bundle = { partyId, code, keyString: null, token: '', endpoints: [] };
      }

      const built = createSession({
        partyId: bundle.partyId,
        code: bundle.code,
        keyString: bundle.keyString,
        token: bundle.token || '',
        endpoints: bundle.endpoints || [],
        selfId,
        role: 'client',
        hostId: null,
      });
      const snapshot = await begin(built, 'client', memberName, 'Party', { handshakeCode, userId });
      AnalyticsEvents.partyJoined(bundle.partyId);
      return snapshot;
    } catch (err) {
      phase = 'error';
      error = String(err?.message || err);
      emit();
      throw err;
    }
  }

  /**
   * Rejoin the party this device was in before the tab was closed.
   *
   * Always as a member, never as the host it may have been: a reloaded tab has
   * no authoritative state to serve, and coming back with an empty one at
   * version 0 would strand every replica ahead of it. If the party really has
   * no host any more, the election promotes this device within one host
   * timeout, and by then it is holding a real replica to be promoted with.
   */
  async function resume({ memberName = 'Guest' } = {}) {
    const saved = loadSession();
    if (!saved?.partyId || !saved?.keyString) return null;
    await teardown();
    phase = 'connecting';
    emit();
    try {
      const built = createSession({
        partyId: saved.partyId,
        code: saved.code,
        keyString: saved.keyString,
        token: saved.token || '',
        endpoints: saved.endpoints || [],
        selfId: saved.selfId || newMemberId(),
        role: 'client',
        hostId: saved.hostId || null,
      });
      return await begin(built, 'client', memberName, saved.partyName || 'Party');
    } catch {
      // A session that will not reopen is worse than none: drop it so the next
      // load offers a clean start rather than failing the same way forever.
      await teardown();
      clearSession();
      emit();
      return null;
    }
  }

  async function leave() {
    if (!session) return;
    const code = session.code;
    // The host's own departure is a command like anybody else's, so the patch
    // that removes it reaches the party before the transports go down.
    host?.applyLocal({ kind: 'leave', from: session.selfId, body: {} });
    await teardown({ announce: true });
    clearSession();
    say(`Left party ${code}`);
    emit();
  }

  /* ------------------------------------------------------------ commands -- */

  /**
   * One path for every state change, host or client. The host runs the command
   * through its own reducer; the client posts it and waits for the patch. The
   * caller cannot tell which, which is the point.
   */
  function submit(kind, body = {}) {
    if (!session) return null;
    if (host) return host.applyLocal({ kind, from: session.selfId, body });
    if (client) return client.submit(kind, body);
    return null;
  }

  const pushBattery = (battery) => {
    if (!battery) return null;
    return submit(HEARTBEAT, { battery });
  };
  const pushLocation = (location) => {
    const me =
      (host && session && host.getState?.()?.members?.[session.selfId]) ||
      (client && session && client.getState?.()?.members?.[session.selfId]) ||
      null;
    const mode = effectiveShareMode(me || { shareMode: 'approx' });
    const shaped = locationForShare(location, mode);
    if (!shaped) return null;
    return submit(LOCATION, { location: shaped });
  };
  const clearLocation = () => submit(LOCATION, { clear: true });
  const setMeet = (meet) => submit(SET_MEET, { meet });
  const setTarget = (rideId) => submit(SET_TARGET, { rideId: rideId || null });

  /**
   * Tell the party a ride is down, or that it is back. `status` is 'down',
   * 'open', or null to retract a report this phone got wrong.
   *
   * Goes through the same command path as everything else, so the host decides
   * and every phone hears the answer — including the phone that reported it,
   * which is what stops two people disagreeing on their own screens.
   */
  const reportRide = (rideId, status, note) =>
    submit(SET_RIDE_STATUS, { rideId, status: status ?? null, note: note ?? null });
  const setStatus = (status) => submit(PATCH_MEMBER, { patch: { status } });

  function setMemberName(name) {
    const clean = String(name || '').trim().slice(0, 24) || 'Guest';
    if (session) {
      session.memberName = clean;
      persistSession();
      submit(PATCH_MEMBER, { patch: { name: clean } });
    }
    return clean;
  }

  const setGroupId = (groupId) => submit(PATCH_MEMBER, { patch: { groupId: groupId || null } });
  const setShareMode = (mode, opts = {}) => {
    if (mode === 'off') return null;
    return submit(PATCH_MEMBER, { patch: shareModePatch(mode, opts) });
  };
  const bindUserId = (userId) => {
    if (session && userId) session.userId = userId;
    return submit(PATCH_MEMBER, { patch: { userId } });
  };
  const setPlan = (plan) => submit(SET_PLAN, { plan: Array.isArray(plan) ? plan : [] });
  const addMember = (body) => submit(ADD_MEMBER, body || {});
  const removeMember = (id) => submit(REMOVE_MEMBER, { id });
  const setMemberFacts = (patch, memberId = null) =>
    submit(PATCH_MEMBER, memberId ? { id: memberId, patch: patch || {} } : { patch: patch || {} });

  async function logAction(kind, detail = {}) {
    try {
      const { append, entryId } = await import('./actionLog.js');
      await append({ id: entryId(), ts: Date.now(), kind, detail });
    } catch {
      // IndexedDB unavailable in tests or SSR.
    }
  }

  /* --------------------------------------------------------- diagnostics -- */

  function stats() {
    const state = partyState();
    let transport = null;
    try {
      transport = manager?.stats?.() ?? null;
    } catch {
      transport = null;
    }
    return {
      phase,
      error,
      role: host ? 'host' : client ? 'client' : null,
      partyId: session?.partyId ?? null,
      code: session?.code ?? null,
      selfId: session?.selfId ?? null,
      hostId: state?.leader ?? session?.hostId ?? null,
      version: state?.version ?? 0,
      members: state ? Object.keys(state.members).length : 0,
      queued: queued(),
      // ms left in which this host will answer a key-request; 0 when it will not
      joinWindow: keyWindowOpen() ? keyWindow.until - Date.now() : 0,
      // { active, candidates: [transport.stats()], probes: [{name, available, reason}] }
      transport,
      statuses: [...statuses.values()],
      party: service()?.stats?.() ?? null,
    };
  }

  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    await teardown();
  }

  /** True when local storage holds an active party that should reopen on load. */
  function hasLiveParty() {
    return isLiveSession(loadSession());
  }

  /** True when a dormant session could be resumed from the Party screen. */
  function hasSavedParty() {
    const saved = loadSession();
    return Boolean(saved?.partyId && saved?.keyString);
  }

  return {
    createParty,
    joinParty,
    resume,
    hasLiveParty,
    hasSavedParty,
    leave,
    allowJoins,
    submit,
    setMeet,
    setTarget,
    reportRide,
    setStatus,
    setMemberName,
    setGroupId,
    setShareMode,
    bindUserId,
    setPlan,
    addMember,
    removeMember,
    setMemberFacts,
    logAction,
    pushLocation,
    pushBattery,
    clearLocation,
    getSnapshot,
    stats,
    destroy,
  };
}
