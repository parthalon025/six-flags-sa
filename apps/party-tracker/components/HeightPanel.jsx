'use client';

import { useEffect, useMemo, useState } from 'react';
import { HEIGHT_TIERS, eligibility, isRideable } from '@/lib/park';
import { usePois } from '@/lib/venue/useVenue';
import {
  MAX_GUESTS,
  addGuestProfile,
  findGuestProfile,
  loadActiveGuestId,
  loadGuestProfiles,
  removeGuestProfile,
  saveActiveGuestId,
  saveGuestProfiles,
  updateGuestProfile,
} from '@/lib/guestProfiles';

/* The height requirement is the thing a family checks twenty times a day, so it
   gets a screen of its own rather than a block at the top of a list: tap a
   tier, read the bar, and everything a rider can't get on fades out on the map
   and drops out of the list behind you.

   A party is usually more than one rider, so this also keeps a small roster
   of guest profiles (label + height + whether an adult is assumed along) in
   localStorage — never on the party wire, since a child's height is nobody
   else's business. Selecting a guest just drives the same height/withAdult
   state this panel always had, so the map, the list and the tally below
   need no separate "which guest" plumbing of their own. */

const TIERS = HEIGHT_TIERS;

export default function HeightPanel({ height, withAdult, onHeight, onWithAdult, venue }) {
  const POIS = usePois();
  const [guests, setGuests] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [guestsLoaded, setGuestsLoaded] = useState(false);

  useEffect(() => {
    setGuests(loadGuestProfiles());
    setActiveId(loadActiveGuestId());
    setGuestsLoaded(true);
  }, []);

  const selectGuest = (id) => {
    const nextId = id === activeId ? null : id;
    setActiveId(nextId);
    saveActiveGuestId(nextId);
    const g = findGuestProfile(guests, nextId);
    if (g) {
      onHeight(g.heightIn);
      onWithAdult(g.withAdult);
    }
  };

  const addGuest = () => {
    const next = addGuestProfile(guests, {
      label: `Guest ${guests.length + 1}`,
      heightIn: height,
      withAdult,
    });
    if (next.length === guests.length) return; // already at MAX_GUESTS
    setGuests(saveGuestProfiles(next));
    selectGuest(next[next.length - 1].id);
  };

  const removeGuest = (id) => {
    setGuests(saveGuestProfiles(removeGuestProfile(guests, id)));
    if (id === activeId) {
      setActiveId(null);
      saveActiveGuestId(null);
    }
  };

  // Hand-adjusting the tier, slider or "adult along" chip while a guest is
  // selected keeps that guest's saved profile in sync, so switching to
  // another guest and back does not lose the change.
  useEffect(() => {
    if (!guestsLoaded || !activeId) return;
    const g = findGuestProfile(guests, activeId);
    if (!g || (g.heightIn === height && g.withAdult === withAdult)) return;
    setGuests(saveGuestProfiles(updateGuestProfile(guests, activeId, { heightIn: height, withAdult })));
    // Only the values themselves should re-sync — re-running this because the
    // guest list object changed would fight the edit it just made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, withAdult]);

  const counts = useMemo(() => {
    if (height == null) return null;
    const tally = { yes: 0, companion: 0, no: 0 };
    POIS.forEach((p) => {
      if (!isRideable(p)) return;
      const v = eligibility(p, height, withAdult);
      if (v === 'yes') tally.yes += 1;
      else if (v === 'companion') tally.companion += 1;
      else tally.no += 1;
    });
    return tally;
  }, [POIS, height, withAdult]);

  // What the next tier would buy — the question behind "is it worth waiting
  // until next summer".
  const nextUnlock = useMemo(() => {
    if (height == null) return null;
    const next = TIERS.find((t) => t > height);
    if (!next) return null;
    let gained = 0;
    POIS.forEach((p) => {
      if (!isRideable(p)) return;
      const now = eligibility(p, height, withAdult);
      const then = eligibility(p, next, withAdult);
      if ((now === 'no' || now === 'toobig') && (then === 'yes' || then === 'companion')) {
        gained += 1;
      }
    });
    return gained > 0 ? { at: next, gained } : null;
  }, [POIS, height, withAdult]);

  return (
    <div>
      {guestsLoaded && (
        <>
          <div className="label">Guests</div>
          <div className="chips guestChips wrap">
            {guests.map((g) => (
              <span key={g.id} className={`guestChip ${g.id === activeId ? 'on' : ''}`}>
                <button
                  type="button"
                  className={`chip ${g.id === activeId ? 'on' : ''}`}
                  onClick={() => selectGuest(g.id)}
                  aria-pressed={g.id === activeId}
                >
                  {g.label}
                  {g.heightIn != null ? ` · ${g.heightIn}"` : ''}
                </button>
                <button
                  type="button"
                  className="chipRemove"
                  onClick={() => removeGuest(g.id)}
                  aria-label={`Remove ${g.label}`}
                >
                  &times;
                </button>
              </span>
            ))}
            {guests.length < MAX_GUESTS && (
              <button type="button" className="chip chipAdd" onClick={addGuest}>
                + Add guest
              </button>
            )}
          </div>
          <p className="fine" style={{ marginTop: 0 }}>
            {guests.length > 0
              ? 'Tap a guest to load their height below, or tap it again to go back to a one-off height. Guests stay on this phone — never sent to the party.'
              : 'Add a guest to save their height and reload it later. Guests stay on this phone — never sent to the party.'}
          </p>
        </>
      )}

      <div className="label">
        Rider Height
        {height != null && (
          <button type="button" className="labelAction" onClick={() => onHeight(null)}>
            Clear
          </button>
        )}
      </div>

      <div className="tierRow" role="group" aria-label="Common height requirements">
        {TIERS.map((t) => (
          <button
            key={t}
            type="button"
            className={`tier ${height === t ? 'on' : ''}`}
            onClick={() => onHeight(t)}
            aria-pressed={height === t}
          >
            {t}
            <em>&quot;</em>
          </button>
        ))}
      </div>

      {height != null ? (
        <div className="heightRow">
          <input
            type="range"
            min="30"
            max="76"
            step="1"
            style={{ '--pct': `${((height - 30) / 46) * 100}%` }}
            value={height}
            onChange={(e) => onHeight(Number(e.target.value))}
            aria-label="Rider height in inches"
          />
          <div className="heightVal">
            <b>{height}</b>
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
          className={`chip ${withAdult ? 'on' : ''}`}
          onClick={() => onWithAdult(!withAdult)}
          aria-pressed={withAdult}
        >
          With adult
        </button>
      </div>

      <p className="fine">
        {venue?.credits
          ? `${venue.credits} `
          : 'Height requirements come with this venue’s own file, not from OpenStreetMap. '}
        The ride operator measures at the gate and has the final say.
      </p>
    </div>
  );
}
