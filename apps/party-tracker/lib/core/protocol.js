/**
 * The wire protocol. Canonical — every transport and both ends speak exactly
 * this and nothing else.
 *
 * An envelope is the only thing that ever crosses a transport boundary. It is
 * transport-agnostic on purpose: the same bytes go over WebRTC, LAN HTTP or a
 * cloud relay, so nothing above the transport layer can tell which is in play.
 *
 * Wire shape, after sealing:
 *
 *   { v, pid, iv, ct }
 *
 * where `ct` is AES-GCM ciphertext over the JSON of an inner frame:
 *
 *   { seq, ts, kind, from, to, body }
 *
 * `pid` and `iv` travel in the clear because a relay has to route on party id
 * without being able to read anything. Everything else is opaque to it.
 */

export const PROTOCOL_VERSION = 1;

/** Client -> host. Commands: the client asks, the host decides. */
export const HELLO = 'hello'; // join: { member }
export const LOCATION = 'location'; // GPS: { location }
export const HEARTBEAT = 'heartbeat'; // liveness + battery: { battery, status }
export const PATCH_MEMBER = 'patch-member'; // rename, status: { patch }
export const SET_FAVORITE = 'set-favorite'; // { rideId, favorite }
export const SET_TARGET = 'set-target'; // { rideId | null }
export const SET_RIDE_STATUS = 'set-ride-status'; // { rideId, status: 'open'|'down'|null, note? }
export const SET_MEET = 'set-meet'; // { meet | null }
export const SET_PLAN = 'set-plan'; // { plan: [{ id, placeId, label }] }
export const APPLY_CONTRIBUTION = 'apply-contribution'; // Overlay: { contribution }
export const ADD_MEMBER = 'add-member'; // device-less seat: { id, name, height?, withAdult?, groupId? }
export const REMOVE_MEMBER = 'remove-member'; // drop a device-less seat: { id }
export const WORLD_OFFER = 'world-offer'; // { skinId }
export const WORLD_WITHDRAW = 'world-withdraw'; // { skinId? }
export const WORLD_MARK = 'world-mark'; // { type, placeId, lat, lng, venueId, phrase? }
export const WORLD_THANKS = 'world-thanks'; // { targetId, profileId }
export const BYE = 'bye'; // leave: {}
export const RESYNC = 'resync'; // { haveVersion }

/** Host -> client. Facts: the host has already decided. */
export const WELCOME = 'welcome'; // { snapshot, youId }
export const SNAPSHOT = 'snapshot'; // { snapshot } — full state
export const PATCH = 'patch'; // { version, ops } — incremental
export const PING = 'ping'; // host liveness beacon: { version }
export const ERROR = 'error'; // { code, message }

/** Peer <-> peer. Leader election, used only when the host goes quiet. */
export const CLAIM = 'claim'; // { score, joinOrder }
export const VOTE = 'vote'; // { forId }
export const VICTORY = 'victory'; // { snapshot } — new host asserts itself

export const CLIENT_KINDS = new Set([
  HELLO, LOCATION, HEARTBEAT, PATCH_MEMBER, SET_FAVORITE, SET_TARGET, SET_RIDE_STATUS, SET_MEET,
  SET_PLAN, APPLY_CONTRIBUTION, ADD_MEMBER, REMOVE_MEMBER, WORLD_OFFER, WORLD_WITHDRAW, WORLD_MARK, WORLD_THANKS, BYE, RESYNC,
]);

export const HOST_KINDS = new Set([WELCOME, SNAPSHOT, PATCH, PING, ERROR]);

export const ELECTION_KINDS = new Set([CLAIM, VOTE, VICTORY]);

export const ALL_KINDS = new Set([...CLIENT_KINDS, ...HOST_KINDS, ...ELECTION_KINDS]);

/** Broadcast address. `to: EVERYONE` means every peer in the party. */
export const EVERYONE = '*';

/**
 * Build an inner frame. `seq` is per-sender and strictly increasing; the
 * receiver uses (from, seq) to drop duplicates that arrive over two transports
 * at once, which is normal during a failover.
 */
export function frame({ seq, kind, from, to = EVERYONE, body = {}, ts = Date.now() }) {
  if (!ALL_KINDS.has(kind)) throw new Error(`unknown message kind: ${kind}`);
  return { seq, ts, kind, from, to, body };
}

/** Cheap structural validation. Anything failing this never reaches the state machine. */
export function isValidFrame(f) {
  return Boolean(
    f &&
      typeof f === 'object' &&
      Number.isFinite(f.seq) &&
      Number.isFinite(f.ts) &&
      typeof f.from === 'string' &&
      f.from.length > 0 &&
      typeof f.to === 'string' &&
      ALL_KINDS.has(f.kind) &&
      f.body !== null &&
      typeof f.body === 'object',
  );
}

/** True when a frame addressed `to` should be handled by the peer `selfId`. */
export function addressedTo(f, selfId) {
  return f.to === EVERYONE || f.to === selfId;
}

/**
 * Duplicate suppression. One instance per receiver; it remembers the highest
 * seq seen per sender and rejects anything at or below it.
 *
 * Senders reset `seq` to 0 when they reconnect with a new session, so a large
 * backwards jump is treated as a new run rather than a replay.
 */
export function createDedupe({ resetGap = 64 } = {}) {
  const high = new Map();
  return {
    /** @returns true if this frame is fresh and should be processed. */
    accept(from, seq) {
      const seen = high.get(from);
      if (seen == null || seq > seen || seq < seen - resetGap) {
        high.set(from, seq);
        return true;
      }
      return false;
    },
    forget(from) {
      high.delete(from);
    },
    reset() {
      high.clear();
    },
  };
}
