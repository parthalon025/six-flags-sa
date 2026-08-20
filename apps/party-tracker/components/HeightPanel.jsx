'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { HEIGHT_TIERS, isRideable } from '@/lib/park';
import { fromFacts } from '@/lib/eligibility';
import { identityOf } from '@/lib/venue/ids';
import { usePois } from '@/lib/venue/useVenue';

/* The height requirement is the thing a family checks twenty times a day, so it
   gets a screen of its own rather than a block at the top of a list: pick who,
   tap a tier, read the bar, and everything that rider can't get on fades out on
   the map and drops out of the list behind you.

   Who this panel may edit is not a style question, it is the protocol. Only a
   device-holding phone may patch a device-less seat: lib/core/state.js
   `patch-member` runs every other-Member patch through `deviceLessSeat`, and a
   patch that fails it is dropped in silence — no error, no toast, and the value
   snaps back on the host's next snapshot. So the picker offers exactly the
   seats this phone is allowed to write: itself, and the Members with no phone
   of their own. A peer holding their own phone is shown, with their height,
   and given no tier row, no slider and no "Set a height" — an affordance that
   quietly does nothing is worse than no affordance at all.

   (This replaces the earlier rule, "this panel edits this phone's own height /
   With adult", which was the safe reading of the same protocol before the
   device-less case was wired. Map, list and glance Eligibility still comes from
   fromFacts(Party|solo) — this is not a second guest-chip roster.)

   The picked rider's draft height rides in `preview`, the one-Member override
   fromFacts already carries, and it stays inside this panel: the sheet subtitle
   and the map's filter badge both say "this phone's height", so letting a
   preview of somebody else's leak into them would make three surfaces disagree
   about whose number is on screen. */

const TIERS = HEIGHT_TIERS;

const SELF = 'self';

const inchesOf = (m) => (Number.isFinite(m?.height) ? m.height : null);

const soloFacts = (height, withAdult) => ({
  solo: { height, withAdult, name: 'You' },
});

export default function HeightPanel({
  height,
  withAdult,
  onHeight,
  onWithAdult,
  onMemberHeight = null,
  onMemberWithAdult = null,
  members = [],
  myId = null,
  inParty = false,
  focus = null,
  venue,
}) {
  const POIS = usePois();
  const selfId = myId || SELF;

  /* Self first, then the seats with no phone, in roster order. Peers are not in
     here at all — see the note above. Self's chip reads the live `height` prop
     rather than the roster's copy of it, so the number on the chip and the
     number under the slider are the same one while it is being dragged. */
  const editable = useMemo(() => {
    if (!inParty) return [];
    const self = members.find((m) => m.id === myId) || null;
    const seats = members.filter((m) => m.deviceLess);
    if (!self && !seats.length) return [];
    return [
      { id: selfId, name: self?.name || 'You', height: height ?? null, self: true },
      ...seats.map((m) => ({ id: m.id, name: m.name, height: inchesOf(m), colour: m.colour })),
    ];
  }, [inParty, members, myId, selfId, height]);

  const peers = useMemo(
    () => (inParty ? members.filter((m) => !m.deviceLess && m.id !== myId) : []),
    [inParty, members, myId],
  );

  const [pickId, setPickId] = useState(selfId);
  /* Panel-local, so dragging the slider for a seat is smooth while the patch
     round-trips through the host. Never the source of truth: it is dropped the
     moment the roster reports a value for that seat, so what the party actually
     agreed on is what stays on screen. */
  const [draft, setDraft] = useState(null);

  const picked = pickId === selfId ? null : members.find((m) => m.id === pickId) || null;
  const pickedIsSelf = pickId === selfId;
  const committed = pickedIsSelf ? null : inchesOf(picked);

  // A seat that left the party, or a party that ended, hands the panel back to
  // the phone holding it rather than editing a Member who is no longer there.
  useEffect(() => {
    if (pickId !== selfId && !members.some((m) => m.id === pickId && m.deviceLess)) {
      setPickId(selfId);
    }
  }, [members, pickId, selfId]);

  useEffect(() => {
    setDraft(null);
  }, [pickId, committed]);

  // A roster card's "Set a height" arrives as {memberId, nonce} — the nonce so
  // tapping the same card twice still re-picks it.
  useEffect(() => {
    if (focus?.memberId) setPickId(focus.memberId);
  }, [focus]);

  const pickedHeight = pickedIsSelf
    ? (height ?? null)
    : draft?.id === pickId
      ? draft.height
      : committed;
  const pickedWithAdult = pickedIsSelf ? withAdult : picked?.withAdult !== false;
  const pickedName = pickedIsSelf
    ? editable.find((e) => e.id === selfId)?.name || 'You'
    : picked?.name || 'This rider';

  const setPickedHeight = useCallback(
    (inches) => {
      if (pickedIsSelf) {
        onHeight?.(inches);
        return;
      }
      setDraft({ id: pickId, height: inches });
      onMemberHeight?.(pickId, inches);
    },
    [pickedIsSelf, onHeight, onMemberHeight, pickId],
  );

  const setPickedWithAdult = useCallback(
    (next) => {
      if (pickedIsSelf) {
        onWithAdult?.(next);
        return;
      }
      onMemberWithAdult?.(pickId, next);
    },
    [pickedIsSelf, onWithAdult, onMemberWithAdult, pickId],
  );

  /* One set of facts, asked at whatever height the question is about. In a
     Party that is the whole Party with the picked rider's draft height laid
     over them — the same most-restrictive fold the map runs, so the bar and the
     map can never tell a family two different stories. Alone it is the solo
     facts this panel has always used. */
  const factsAt = useCallback(
    (inches) => {
      if (inParty && members.length) {
        return {
          party: {
            selfId,
            members: members.map((m) => ({
              id: m.id,
              name: m.name,
              height: inchesOf(m),
              withAdult: m.withAdult,
              groupId: m.groupId || null,
            })),
          },
          preview: { memberId: pickId, height: inches },
        };
      }
      return soloFacts(inches, pickedWithAdult);
    },
    [inParty, members, selfId, pickId, pickedWithAdult],
  );

  const counts = useMemo(() => {
    /* With a height there is always something to count. Without one there is
       only a Party to count — and a Party whose roster has not landed yet is
       not one, so that case falls through to the "pick a height" line rather
       than drawing three empty segments. */
    if (pickedHeight == null && !(inParty && members.length)) return null;
    const elig = fromFacts(factsAt(pickedHeight), POIS);
    const tally = { yes: 0, companion: 0, no: 0, unknown: 0 };
    POIS.forEach((p) => {
      if (!isRideable(p)) return;
      const k = elig.at(identityOf(p)).kind;
      if (k === 'eligible') tally.yes += 1;
      else if (k === 'companion') tally.companion += 1;
      else if (k === 'not' || k === 'advisory') tally.no += 1;
      else if (k === 'unknown') tally.unknown += 1;
    });
    return tally;
  }, [POIS, factsAt, pickedHeight, inParty, members.length]);

  // What the next tier would buy — the question behind "is it worth waiting
  // until next summer".
  const nextUnlock = useMemo(() => {
    if (pickedHeight == null) return null;
    const next = TIERS.find((t) => t > pickedHeight);
    if (!next) return null;
    const now = fromFacts(factsAt(pickedHeight), POIS);
    const then = fromFacts(factsAt(next), POIS);
    let gained = 0;
    POIS.forEach((p) => {
      if (!isRideable(p)) return;
      const id = identityOf(p);
      const later = then.at(id).kind;
      if (now.at(id).blocks && (later === 'eligible' || later === 'companion')) {
        gained += 1;
      }
    });
    return gained > 0 ? { at: next, gained } : null;
  }, [POIS, factsAt, pickedHeight]);

  const showPicker = editable.length > 1;

  return (
    <div>
      <div className="label">
        {inParty ? 'Party Heights' : 'Rider Height'}
        {pickedHeight != null && (
          <button
            type="button"
            className="labelAction"
            onClick={() => setPickedHeight(null)}
          >
            Clear
          </button>
        )}
      </div>

      {showPicker ? (
        <div className="chips" role="group" aria-label="Whose height to set">
          {editable.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`chip ${pickId === w.id ? 'on' : ''}`}
              aria-pressed={pickId === w.id}
              onClick={() => setPickId(w.id)}
            >
              {w.name}
              {w.height != null ? ` ${w.height}"` : ''}
            </button>
          ))}
        </div>
      ) : null}

      <div className="tierRow" role="group" aria-label={`Common height requirements for ${pickedName}`}>
        {TIERS.map((t) => (
          <button
            key={t}
            type="button"
            className={`tier ${pickedHeight === t ? 'on' : ''}`}
            onClick={() => setPickedHeight(t)}
            aria-pressed={pickedHeight === t}
          >
            {t}
            <em>in</em>
          </button>
        ))}
      </div>

      {pickedHeight != null ? (
        <div className="heightRow">
          <input
            type="range"
            min="30"
            max="76"
            step="1"
            style={{ '--pct': `${((pickedHeight - 30) / 46) * 100}%` }}
            value={pickedHeight}
            onChange={(e) => setPickedHeight(Number(e.target.value))}
            aria-label={`Height in inches for ${pickedName}`}
          />
          <div className="heightVal">
            <b>{pickedHeight}</b>
            <span>in</span>
          </div>
        </div>
      ) : null}

      {counts ? (
        <>
          <div
            className="ratioBar"
            role="img"
            aria-label={`${counts.yes} rides tall enough for, ${counts.companion} with an adult along, ${counts.no} too short for`}
          >
            <span className="seg ok" style={{ flexGrow: counts.yes || 0.001 }} />
            <span className="seg warn" style={{ flexGrow: counts.companion || 0.001 }} />
            <span className="seg bad" style={{ flexGrow: counts.no || 0.001 }} />
          </div>
          <div className="ratioKey">
            <span className="ok">
              <b>{counts.yes}</b> can ride
            </span>
            <span className="warn">
              <b>{counts.companion}</b> with adult
            </span>
            <span className="bad">
              <b>{counts.no}</b> too short
            </span>
          </div>
          {/* A ride whose height rule the venue has not published is not a ride
              anybody is too short for, so it stays out of the three segments and
              says so here instead of being quietly counted as a no. */}
          {counts.unknown > 0 ? (
            <p className="fine" style={{ marginTop: 0 }}>
              {counts.unknown} more publish no height — ask at the gate.
            </p>
          ) : null}
          {nextUnlock && (
            <p className="unlock">
              <b>{nextUnlock.gained} more</b> unlock at {nextUnlock.at}&quot;
            </p>
          )}
        </>
      ) : (
        <p className="fine" style={{ marginTop: 0 }}>
          Pick a height to see what a rider can get on. Anything they can&apos;t ride
          fades out on the map too.
        </p>
      )}

      <div className="label">With adult</div>
      <div className="chips">
        <button
          type="button"
          className={`chip ${pickedWithAdult ? 'on' : ''}`}
          onClick={() => setPickedWithAdult(!pickedWithAdult)}
          aria-pressed={pickedWithAdult}
        >
          With an adult along
        </button>
      </div>

      {peers.length > 0 ? (
        <>
          <div className="label">Everyone else</div>
          {/* Read-only on purpose: a phone may not patch another phone's
              Member, and a tier row here would animate, update this screen and
              then revert on the host's next snapshot. They set their own. */}
          <ul className="heightPeers">
            {peers.map((m) => (
              <li key={m.id}>
                <span className="heightPeerDot" style={{ background: m.colour }} aria-hidden="true" />
                <b>{m.name}</b>
                <span>{inchesOf(m) != null ? `${inchesOf(m)}"` : 'No height set'}</span>
              </li>
            ))}
          </ul>
          <p className="fine" style={{ marginTop: 0 }}>
            They set theirs on their own phone.
          </p>
        </>
      ) : null}

      <p className="fine">
        {inParty
          ? 'Each Member carries their own height; the map shows the most restrictive one. The operator measures at the gate.'
          : 'The ride operator measures at the gate and has the final say.'}
        <span className="block">
          {venue?.credits
            ? venue.credits
            : 'Height requirements come with this venue’s own file, not from OpenStreetMap.'}
        </span>
      </p>
    </div>
  );
}
