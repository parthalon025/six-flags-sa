'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import SignInCard from '@/components/SignInCard';
import SpotBanner from '@/components/SpotBanner';
import { softGateBlocks } from '@/lib/auth/session';
import {
  EARNED_MARK_TYPES,
  MARK_ICONS,
  MARK_LABELS,
  marksByType,
  PLACEABLE_MARK_TYPES,
  SIGN_PHRASES,
} from '@/lib/world';

/**
 * Marks — the two you place, and the four your Contributions leave for you.
 *
 * The split is the screen. `recordSideQuest` mints plaque, lantern, cairn and
 * sticker; `dropMark` is the only path to a sign or a beacon. Rendering all six
 * as chips (which this screen's predecessor inside Collection did) let a guest
 * hand-place evidence — and `visibleMarks` and `thankMark` cannot tell a placed
 * plaque from an earned one, so the four earned types are drawn here as a
 * tally, with no affordance to tap.
 *
 * Placement is anchored, never ambient: a Mark stands at the patch of ground
 * the visitor tapped (`lib/spot.js`), not at wherever their fix happens to be
 * when they open this screen. With no anchor the two rows read "Pick a spot"
 * and do nothing; with no Profile they read "Sign in", because dropMark and the
 * world-mark op both refuse a Mark without an author.
 */

/** What each placeable Mark is for, in the guest's words. */
const PLACEABLE_COPY = {
  sign: 'A phrase from the closed list, standing at this spot.',
  beacon: 'Points at something worth walking to. No words.',
};

/* What earns each of the four, read off recordSideQuest rather than invented.
   The lantern line in particular: plaque and lantern are pushed from the same
   `base` in the same branch — same Place, same instant — so a lantern is not
   something that arrives later beside a height somebody else settled. */
const EARNED_COPY = {
  plaque: 'A height rule you settled at a ride.',
  lantern: 'Lit beside the height plaque, for the next family walking up.',
  cairn: 'A path or shape the map was missing.',
  sticker: 'Anything you reported at a Place.',
};

export default function WorldMarks({
  session = null,
  onSession = null,
  /** The merged park + party world, for the earned tally. */
  world = null,
  /** The anchored patch of ground — `lib/spot.js`. Null until the visitor taps
   *  "Leave a Mark" on the map's spot capsule. */
  spot = null,
  onClearSpot = null,
  onDropMark = null,
}) {
  const needsProfile = softGateBlocks('world', session);
  const anchored = Boolean(spot);
  const [signOpen, setSignOpen] = useState(false);
  const [phrase, setPhrase] = useState(null);
  // Which types this visit has already stood at *this* spot. Moving the anchor
  // starts a fresh patch of ground, so the "Placed" ticks go with it.
  const [placed, setPlaced] = useState([]);
  useEffect(() => {
    setPlaced([]);
    setSignOpen(false);
    setPhrase(null);
  }, [spot?.lat, spot?.lng]);

  async function drop(type, signPhrase = null) {
    if (!spot) return;
    const saved = await onDropMark?.({
      type,
      phrase: signPhrase,
      lat: spot.lat,
      lng: spot.lng,
      placeId: spot.placeId || null,
    });
    if (saved === false) return;
    setPlaced((list) => (list.includes(type) ? list : [...list, type]));
    if (type === 'sign') setSignOpen(false);
  }

  /* "By The Beast" → "by The Beast"; open ground keeps its Zone. The same
     phrasing the spot capsule uses, so the two screens name one place alike. */
  const where = spot
    ? spot.name.startsWith('By ')
      ? `${spot.name.replace(/^By /, 'by ')}, ${spot.zone}`
      : `on open ground in ${spot.zone}`
    : '';

  let foot = 'Tap a spot on the map first — a Mark stands somewhere, not everywhere.';
  let footTone = 'quiet';
  if (needsProfile) {
    foot = 'A Mark carries who left it, so leaving one needs a Profile. Reading the map never does.';
  } else if (anchored && signOpen) {
    foot = phrase
      ? `Sign standing ${where} — “${phrase}”.`
      : 'Pick one of the five phrases for this sign.';
    footTone = phrase ? 'ready' : '';
  } else if (anchored && placed.length) {
    const last = placed[placed.length - 1];
    foot = `${MARK_LABELS[last]} standing ${where}. Your Party sees it now.`;
    footTone = 'ready';
  } else if (anchored) {
    foot = `Anchored ${where}. Pick which Mark stands here.`;
    footTone = '';
  }

  /* A Mark carries an authorId — `dropMark` and the world-mark op both refuse
     one without a Profile — so signed out the rows say so rather than offering
     a Place that would be dropped on the floor. They still draw: what a Sign
     and a Beacon are is worth reading before deciding to sign in. */
  const blocked = needsProfile || !anchored;

  function stateOf(type) {
    if (needsProfile) return 'Sign in';
    if (!anchored) return 'Pick a spot';
    if (placed.includes(type)) return 'Placed';
    if (type === 'sign' && signOpen) return 'Pick a phrase';
    return 'Place';
  }

  return (
    <div className="worldMarks">
      {spot ? <SpotBanner spot={spot} onClear={onClearSpot} /> : null}

      <div className="label eyebrow">Leave a Mark</div>
      <p className="fine">
        Two of the six are yours to place. Your Party sees it now; other guests after a second
        Party Thanks it. Marks dim after a week and go after four.
      </p>

      <div className={`rowList markList placeable ${blocked ? 'unanchored' : ''}`}>
        {PLACEABLE_MARK_TYPES.map((type) => {
          const on = type === 'sign' && signOpen;
          const done = placed.includes(type);
          return (
            <button
              key={type}
              type="button"
              className={`row flat markRow ${on || done ? 'on' : ''}`}
              /* Not `disabled`: a row nobody can act on yet is still worth
                 reading, and a disabled button is skipped by a screen reader
                 walking the list. It announces as unavailable and does
                 nothing. */
              aria-disabled={blocked}
              onClick={() => {
                if (blocked || done) return;
                if (type === 'sign') {
                  setSignOpen((v) => !v);
                  return;
                }
                drop(type);
              }}
            >
              <span className="markGlyph" aria-hidden="true">
                <Icon name={MARK_ICONS[type]} size={17} />
              </span>
              <span className="rowText">
                <b>{MARK_LABELS[type]}</b>
                <span className="fine">{PLACEABLE_COPY[type]}</span>
              </span>
              <span className={`rowValue markState ${done || on ? 'on' : ''}`}>{stateOf(type)}</span>
            </button>
          );
        })}
      </div>

      {needsProfile ? <SignInCard session={session} onSession={onSession} /> : null}

      {!needsProfile && signOpen && anchored ? (
        <div className="markPhrases">
          <div className="label eyebrow">Choose the phrase</div>
          <div className="chips wrap">
            {SIGN_PHRASES.map((phraseOption) => (
              <button
                key={phraseOption}
                type="button"
                className={`chip ${phrase === phraseOption ? 'on' : ''}`}
                aria-pressed={phrase === phraseOption}
                onClick={() => setPhrase(phraseOption)}
              >
                {phraseOption}
              </button>
            ))}
          </div>
          {/* The gate is this button's disabled state, not its wording:
              `dropMark` silently falls back to SIGN_PHRASES[0] when a sign
              arrives without one, so a tappable "Place" with no phrase chosen
              would quietly plant "Queue this way" in the park. */}
          <button
            type="button"
            className="btn small primary rect markPlace"
            disabled={!phrase}
            onClick={() => drop('sign', phrase)}
          >
            <Icon name={MARK_ICONS.sign} size={15} /> Place the sign
          </button>
        </div>
      ) : null}

      <p className={`fine block markFoot ${footTone}`}>{foot}</p>

      <div className="label eyebrow">Left by your Contributions</div>
      <p className="fine">
        The other four are placed for you when a Side Quest settles. You never pick these.
      </p>
      <div className="rowList markList earnedList">
        {EARNED_MARK_TYPES.map((type) => (
          <div key={type} className="row flat markRow earned">
            <span className="markGlyph" aria-hidden="true">
              <Icon name={MARK_ICONS[type]} size={17} />
            </span>
            <span className="rowText">
              <b>{MARK_LABELS[type]}</b>
              <span className="fine">{EARNED_COPY[type]}</span>
            </span>
            {/* An em dash, not a zero: with no Profile there is nothing to
                count, and "0" reads as "you have earned none". */}
            <span className="rowValue markCount">
              {session?.userId ? marksByType(world, type, session.userId).length : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
