/**
 * Party state and the rules for changing it. Canonical.
 *
 * This module is pure: no network, no storage, no browser. It is the same code
 * on the host phone, in the Node host and in the tests, which is the whole
 * point of keeping the domain separate from the transport.
 *
 * The host owns the only authoritative copy. Clients hold a replica they never
 * mutate directly — they send commands and apply the patches that come back.
 *
 * Every accepted command bumps `version` by exactly one and emits the ops that
 * produced it. A client that receives version N+2 while holding N knows it
 * missed a patch and asks for a resync, so gaps repair themselves.
 */

/** How long a member can go unheard from before the roster drops them. */
export const MEMBER_TTL_MS = 45 * 60 * 1000;
/** How long a party survives with nobody in it. */
export const PARTY_TTL_MS = 8 * 60 * 60 * 1000;
/** Missing this many heartbeats marks a member stale (but still listed). */
export const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Ride reports. A member walks past a ride, sees the queue turned out, and
 * tells the party — which is the only live operating status this app has, and
 * during a weather hold the only one anybody trusts anyway.
 *
 * Unlike a member record, a ride report is not owned by whoever wrote it: the
 * next person to walk past may correct it, and the reducer lets them. It is
 * crowd data about a shared object, not a claim about a person.
 */
export const RIDE_DOWN = 'down';
export const RIDE_OPEN = 'open';
export const RIDE_STATUSES = new Set([RIDE_OPEN, RIDE_DOWN]);

/** Past this, a report is archaeology and stops being shown. */
export const RIDE_REPORT_TTL_MS = 90 * 60 * 1000;
/** Under this, re-reporting the same thing is a no-op rather than a patch. */
export const RIDE_CONFIRM_MS = 5 * 60 * 1000;
/** Past this, a report is still shown but flagged as possibly out of date. */
export const RIDE_STALE_AFTER_MS = 30 * 60 * 1000;

/** Most a member may star. See `set-favorite` for why there is a ceiling. */
export const FAVORITES_MAX = 20;

export const ROLE_HOST = 'host';
export const ROLE_MEMBER = 'member';

export function createParty({ id, name = 'Party', leader, now = Date.now(), transport = null }) {
  return {
    id,
    name,
    leader,
    createdAt: now,
    version: 0,
    transport,
    members: {},
    rides: {},
    meet: null,
    // Reserved. No command emits SETTINGS_MERGE yet, so this is empty by
    // design: it is the slot the first genuinely party-wide setting drops
    // into, and OP.SETTINGS_MERGE is the mechanism that will replicate it.
    settings: {},
  };
}

export function createMember({
  id,
  name = 'Guest',
  role = ROLE_MEMBER,
  joinOrder = 0,
  groupId = null,
  now = Date.now(),
}) {
  return {
    id,
    name,
    role,
    joinOrder,
    groupId,
    location: null, // { lat, lng, acc, heading, speed, ts }
    battery: null, // { level, charging }
    status: 'On the move',
    target: null, // rideId the member is heading for
    favorites: [],
    sharingPaused: false,
    lastSeen: now,
  };
}

/** Coarsen a fix before it leaves the phone (~50 m grid). */
export function coarsenLocation(loc, metres = 50) {
  if (!loc) return loc;
  const latStep = metres / 110540;
  const lngStep = metres / (111320 * Math.cos(loc.lat * (Math.PI / 180)));
  return {
    ...loc,
    lat: Math.round(loc.lat / latStep) * latStep,
    lng: Math.round(loc.lng / lngStep) * lngStep,
  };
}

/** Copy every replicated collection from a snapshot — add new ones here only. */
export function adoptSnapshot(target, snap) {
  return {
    ...target,
    id: snap.id,
    name: snap.name,
    leader: snap.leader,
    createdAt: snap.createdAt,
    version: snap.version,
    transport: snap.transport,
    members: snap.members,
    rides: snap.rides,
    meet: snap.meet,
    settings: snap.settings,
  };
}

/**
 * An op is the smallest description of a change. Patches are lists of ops, and
 * applying the same op list to a replica reproduces the host's state exactly.
 */
export const OP = {
  MEMBER_SET: 'member.set', // { id, member }   whole record
  MEMBER_MERGE: 'member.merge', // { id, patch }    shallow merge
  MEMBER_DEL: 'member.del', // { id }
  RIDE_MERGE: 'ride.merge', // { id, patch }
  RIDE_DEL: 'ride.del', // { id }
  MEET_SET: 'meet.set', // { meet }
  LEADER_SET: 'leader.set', // { leader }
  SETTINGS_MERGE: 'settings.merge', // { patch }
};

/** Apply ops to a state object, returning a new state. Used by host and client alike. */
export function applyOps(state, ops) {
  let next = state;
  const clone = () => {
    if (next === state) next = { ...state, members: { ...state.members }, rides: { ...state.rides } };
    return next;
  };

  for (const op of ops) {
    switch (op.type) {
      case OP.MEMBER_SET:
        clone().members[op.id] = op.member;
        break;
      case OP.MEMBER_MERGE: {
        const cur = next.members[op.id];
        if (!cur) break; // a merge for someone already gone is a no-op, not an error
        clone().members[op.id] = { ...cur, ...op.patch };
        break;
      }
      case OP.MEMBER_DEL:
        if (next.members[op.id]) delete clone().members[op.id];
        break;
      case OP.RIDE_MERGE:
        clone().rides[op.id] = { ...(next.rides[op.id] || { id: op.id }), ...op.patch };
        break;
      case OP.RIDE_DEL:
        if (next.rides[op.id]) delete clone().rides[op.id];
        break;
      case OP.MEET_SET:
        clone().meet = op.meet;
        break;
      case OP.LEADER_SET:
        clone().leader = op.leader;
        break;
      case OP.SETTINGS_MERGE:
        clone().settings = { ...next.settings, ...op.patch };
        break;
      default:
        break; // forwards compatible: an op we don't know is skipped, not fatal
    }
  }
  return next;
}

/* ----------------------------------------------------------- reducer ----- */

/**
 * The host's decision function. Takes the current state and one command from a
 * member, returns `{ state, ops }`. `ops` empty means the command changed
 * nothing and no patch needs broadcasting — which is the common case for a
 * heartbeat and is what keeps idle parties quiet.
 *
 * Rules, in the spec's terms:
 *   - The host always wins: this function is only ever run on the host.
 *   - A later timestamp replaces an earlier one; a stale update is dropped.
 *   - Nobody can edit anybody else's record.
 */
export function reduce(state, command, now = Date.now()) {
  const { kind, from, body } = command;
  const me = state.members[from];

  switch (kind) {
    case 'join': {
      const existing = state.members[from];
      // Rejoining after a refresh keeps the original join order, which is the
      // last tiebreak in leader election and shouldn't reshuffle on reconnect.
      const member = createMember({
        id: from,
        name: body.name || existing?.name || 'Guest',
        role: from === state.leader ? ROLE_HOST : ROLE_MEMBER,
        joinOrder: existing?.joinOrder ?? nextJoinOrder(state),
        now,
      });
      if (existing) {
        member.location = existing.location;
        member.favorites = existing.favorites;
        member.target = existing.target;
      }
      return withOps(state, [{ type: OP.MEMBER_SET, id: from, member }]);
    }

    case 'location': {
      if (!me) return none(state);
      if (me.sharingPaused) return none(state);
      const loc = body.location;
      if (!isValidLocation(loc)) return none(state);
      // Last valid update replaces the previous one; anything older is a
      // reordered packet and is ignored.
      if (me.location && loc.ts <= me.location.ts) return none(state);
      return withOps(state, [
        { type: OP.MEMBER_MERGE, id: from, patch: { location: loc, lastSeen: now } },
      ]);
    }

    case 'heartbeat': {
      if (!me) return none(state);
      const patch = { lastSeen: now };
      if (body.battery !== undefined) patch.battery = body.battery;
      if (body.status !== undefined) patch.status = body.status;
      // A heartbeat that carries nothing new still refreshes lastSeen, but
      // lastSeen alone is not worth a broadcast — the host tracks it locally
      // and lets the next real patch carry it.
      const interesting = body.battery !== undefined || body.status !== undefined;
      const next = applyOps(state, [{ type: OP.MEMBER_MERGE, id: from, patch }]);
      if (!interesting) return { state: next, ops: [], silent: true };
      return {
        state: { ...next, version: state.version + 1 },
        ops: [{ type: OP.MEMBER_MERGE, id: from, patch }],
      };
    }

    case 'patch-member': {
      if (!me) return none(state);
      const patch = {};
      if (typeof body.patch?.name === 'string') patch.name = body.patch.name.slice(0, 24);
      if (body.patch?.status !== undefined) patch.status = body.patch.status;
      if (body.patch?.groupId !== undefined) patch.groupId = body.patch.groupId || null;
      if (body.patch?.sharingPaused !== undefined) patch.sharingPaused = Boolean(body.patch.sharingPaused);
      if (!Object.keys(patch).length) return none(state);
      patch.lastSeen = now;
      return withOps(state, [{ type: OP.MEMBER_MERGE, id: from, patch }]);
    }

    case 'set-favorite': {
      if (!me || !body.rideId) return none(state);
      const has = me.favorites.includes(body.rideId);
      if (has === Boolean(body.favorite)) return none(state);
      // Capped because this array rides in every member record, and a member
      // record rides in `publicSnapshot` — which goes out on WELCOME, on every
      // resync SNAPSHOT and on every VICTORY frame, and a contested election
      // re-asserts roughly every 1.5 s. An unbounded list is therefore an
      // unbounded payload at the exact moment the party is least healthy. A
      // party that has already starred 20 rides gains nothing from the 21st;
      // adding past the cap is a no-op rather than an error, so an older build
      // that does not know about the cap is not broken by it.
      if (body.favorite && me.favorites.length >= FAVORITES_MAX) return none(state);
      const favorites = body.favorite
        ? [...me.favorites, body.rideId]
        : me.favorites.filter((r) => r !== body.rideId);
      return withOps(state, [{ type: OP.MEMBER_MERGE, id: from, patch: { favorites } }]);
    }

    case 'set-target': {
      if (!me) return none(state);
      const target = body.rideId || null;
      if (me.target === target) return none(state);
      return withOps(state, [{ type: OP.MEMBER_MERGE, id: from, patch: { target } }]);
    }

    case 'set-ride-status': {
      if (!me) return none(state);
      const rideId = typeof body.rideId === 'string' ? body.rideId.slice(0, 80) : '';
      if (!rideId) return none(state);
      const current = state.rides[rideId] || null;

      // A retraction — "I was wrong, or it came back" — removes the record
      // rather than writing an `open` over it, so an unreported ride and a ride
      // somebody cleared look identical to everything downstream.
      if (body.status == null) {
        if (!current) return none(state);
        return withOps(state, [{ type: OP.RIDE_DEL, id: rideId }]);
      }

      if (!RIDE_STATUSES.has(body.status)) return none(state);

      // Re-reporting what the party already believes is how you say "still
      // down" after twenty minutes, so it refreshes the clock — but doing it
      // twice in a minute is a double tap, and that is not worth a broadcast.
      if (current && current.status === body.status && now - current.ts < RIDE_CONFIRM_MS) {
        return none(state);
      }

      const patch = {
        status: body.status,
        by: from,
        byName: me.name,
        ts: now,
        note: typeof body.note === 'string' ? body.note.slice(0, 60) : null,
      };
      return withOps(state, [{ type: OP.RIDE_MERGE, id: rideId, patch }]);
    }

    case 'set-meet': {
      const meet = body.meet
        ? { ...body.meet, by: me?.name || 'Someone', ts: now, at: body.meet.at || null }
        : null;
      return withOps(state, [{ type: OP.MEET_SET, meet }]);
    }

    case 'leave': {
      if (!me) return none(state);
      return withOps(state, [{ type: OP.MEMBER_DEL, id: from }]);
    }

    case 'set-leader': {
      if (state.leader === body.leader) return none(state);
      const ops = [{ type: OP.LEADER_SET, leader: body.leader }];
      if (state.members[body.leader]) {
        ops.push({ type: OP.MEMBER_MERGE, id: body.leader, patch: { role: ROLE_HOST } });
      }
      if (state.members[state.leader]) {
        ops.push({ type: OP.MEMBER_MERGE, id: state.leader, patch: { role: ROLE_MEMBER } });
      }
      return withOps(state, ops);
    }

    default:
      return none(state);
  }
}

/** Drop members nobody has heard from in a long time. Returns `{ state, ops }`. */
export function evict(state, now = Date.now(), ttl = MEMBER_TTL_MS) {
  const ops = [];
  for (const [id, m] of Object.entries(state.members)) {
    if (now - m.lastSeen > ttl) ops.push({ type: OP.MEMBER_DEL, id });
  }
  return ops.length ? withOps(state, ops) : none(state);
}

/**
 * Drop ride reports nobody has confirmed in a long time.
 *
 * Separate from `evict` because the two ages are unrelated: a member who has
 * been quiet for an hour is probably still in the park, but a "closed" report
 * that old is worse than no report at all — it sends a family walking to a ride
 * that reopened forty minutes ago.
 */
export function evictRides(state, now = Date.now(), ttl = RIDE_REPORT_TTL_MS) {
  const ops = [];
  for (const [id, r] of Object.entries(state.rides)) {
    if (!Number.isFinite(r?.ts) || now - r.ts > ttl) ops.push({ type: OP.RIDE_DEL, id });
  }
  return ops.length ? withOps(state, ops) : none(state);
}

export const isStale = (member, now = Date.now()) => now - member.lastSeen > STALE_AFTER_MS;

/** True when a report is old enough that the UI should hedge it. */
export const isReportStale = (report, now = Date.now()) =>
  !Number.isFinite(report?.ts) || now - report.ts > RIDE_STALE_AFTER_MS;

/* ---------------------------------------------------------- helpers ------ */

function withOps(state, ops) {
  return { state: { ...applyOps(state, ops), version: state.version + 1 }, ops };
}

const none = (state) => ({ state, ops: [] });

const nextJoinOrder = (state) =>
  Object.values(state.members).reduce((max, m) => Math.max(max, m.joinOrder + 1), 0);

export function isValidLocation(loc) {
  return Boolean(
    loc &&
      Number.isFinite(loc.lat) &&
      Number.isFinite(loc.lng) &&
      Math.abs(loc.lat) <= 90 &&
      Math.abs(loc.lng) <= 180 &&
      Number.isFinite(loc.ts),
  );
}

/** Strip anything a peer has no business seeing. Location history is never kept. */
export function publicSnapshot(state) {
  return {
    id: state.id,
    name: state.name,
    leader: state.leader,
    createdAt: state.createdAt,
    version: state.version,
    transport: state.transport,
    members: state.members,
    rides: state.rides,
    meet: state.meet,
    settings: state.settings,
  };
}
