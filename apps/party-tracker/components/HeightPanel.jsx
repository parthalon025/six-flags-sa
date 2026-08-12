'use client';

import { useMemo } from 'react';
import { HEIGHT_TIERS, isRideable } from '@/lib/park';
import { fold } from '@/lib/eligibility';
import { identityOf } from '@/lib/venue/ids';
import { usePois } from '@/lib/venue/useVenue';

/* The height requirement is the thing a family checks twenty times a day, so it
   gets a screen of its own rather than a block at the top of a list: tap a
   tier, read the bar, and everything a rider can't get on fades out on the map
   and drops out of the list behind you.

   This panel edits this phone's own height / With adult. Map, list and glance
   Eligibility is a fold over the Party roster (or this local height when there
   is no Party) — not a second guest-chip roster. */

const TIERS = HEIGHT_TIERS;

const sliderPerson = (height, withAdult) => [
  { id: 'self', name: 'You', height, withAdult: withAdult === true },
];

export default function HeightPanel({ height, withAdult, onHeight, onWithAdult, venue }) {
  const POIS = usePois();

  const counts = useMemo(() => {
    if (height == null) return null;
    const view = fold(sliderPerson(height, withAdult), POIS);
    const tally = { yes: 0, companion: 0, no: 0 };
    POIS.forEach((p) => {
      if (!isRideable(p)) return;
      const k = view.at(identityOf(p)).kind;
      if (k === 'eligible') tally.yes += 1;
      else if (k === 'companion') tally.companion += 1;
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
    const now = fold(sliderPerson(height, withAdult), POIS);
    const then = fold(sliderPerson(next, withAdult), POIS);
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
  }, [POIS, height, withAdult]);

  return (
    <div>
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
