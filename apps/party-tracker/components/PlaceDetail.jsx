'use client';

import { useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import { sendThanks, thankedIds } from '@/lib/adventure/thanks';
import { RIDE_DOWN, RIDE_OPEN } from '@/lib/core/state';
import { liveFor, membersAt } from '@/lib/live';
import { CATEGORY_LABELS, paletteFor } from '@/lib/theme';
import { heightLabel, isRideable } from '@/lib/park';
import { useVenueSelector } from '@/lib/venue/useVenue';
import { campChips, campDetails } from '@/lib/camping';
import { entranceMeta } from '@/lib/entrance';
import { bearing, cardinal, distance, formatDistance, formatWalk } from '@/lib/geo';
import { GLYPHS, WORDS } from '@/lib/brand';
import { identityOf, placeNav } from '@/lib/venue/ids';
import { placeContext } from '@/lib/venue/placeContext';

const VERDICT = {
  eligible: { label: 'Can ride', cls: 'ok', icon: 'checkmark' },
  companion: { label: 'With adult', cls: 'warn', icon: 'checkmark' },
  advisory: { label: 'Advisory', cls: 'warn', icon: 'checkmark' },
  not: { label: 'Too short', cls: 'bad', icon: 'xmark' },
  unknown: { label: 'Unknown', cls: 'unknown', icon: null },
};

/**
 * Walk / Rally / Plan.
 *
 * Two shapes of the same three actions, on one rule about how much screen the
 * caller has. Inside a list row that has expanded under the place you tapped,
 * the icons are enough: the row is one of twenty and the actions have to stay
 * out of the way of the next name down. On the Place's own screen they are the
 * reason the screen exists and there is a whole width to say them in, so they
 * say them — the twin's `Walk me there` / `Add to Plan` / `Rally here`, which
 * is also the first place in the app somebody can *learn* what those three
 * glyphs mean.
 *
 * `labelled` is the opt-in rather than the default because the icon row is what
 * every existing caller wants; only PlaceDetail's own head asks for words.
 */
export function PlaceActions({
  poi,
  onNavigate,
  onSetMeet,
  onAddToPlan = null,
  labelled = false,
  inPlan = false,
}) {
  if (labelled) {
    return (
      <div className="placeActions labelled">
        <button
          type="button"
          className="btn small rect primary placeAction"
          onClick={() => onNavigate(placeNav(poi))}
        >
          {WORDS.navigation}
        </button>
        {onAddToPlan && (
          <button
            type="button"
            className={`btn small rect placeAction placeActionOutline ${inPlan ? 'on' : ''}`}
            onClick={() => onAddToPlan(poi)}
            aria-pressed={inPlan}
          >
            {/* The plan is a set, so the second tap is not a second copy —
                saying so on the button is cheaper than a toast that says it
                after the fact. */}
            {inPlan ? 'In your Plan' : WORDS.addToPlan}
          </button>
        )}
        <button
          type="button"
          className="btn small rect placeAction placeActionOutline"
          onClick={() => onSetMeet(poi)}
        >
          Rally here
        </button>
      </div>
    );
  }

  return (
    <div className="placeActions">
      <button
        type="button"
        className="btn small primary iconOnly"
        onClick={() => onNavigate(placeNav(poi))}
        aria-label={WORDS.navigation}
      >
        <Icon name={GLYPHS.walk} size={18} />
      </button>
      <button
        type="button"
        className="btn small iconOnly"
        onClick={() => onSetMeet(poi)}
        aria-label={WORDS.meetup}
      >
        <Icon name={GLYPHS.meetup} size={18} />
      </button>
      {onAddToPlan && (
        <button
          type="button"
          className="btn small iconOnly"
          onClick={() => onAddToPlan(poi)}
          aria-label={WORDS.addToPlan}
        >
          <Icon name={GLYPHS.plan} size={18} />
        </button>
      )}
    </div>
  );
}

/**
 * The open face of a place: notes, camp checklist, phone, ride status, and the
 * two things you came here to do — walk there, or Rally the Party there.
 * Shared by the list's expanded row and the sheet that opens from a map tap.
 */
export function PlaceDetailBody({
  poi,
  status = null,
  venue = null,
  eligibility = null,
  onNavigate,
  onSetMeet,
  onReport = null,
  onAddToPlan = null,
  showActions = true,
  overlayCompletions = [],
  session = null,
}) {
  // Thanks the finder — remembered per phone; state refreshes after a tap.
  const [thanked, setThanked] = useState(() => thankedIds());
  if (!poi) return null;
  const isRide = isRideable(poi);
  const showStatus = Boolean(status?.label);
  const camp = campChips(campDetails(poi, venue));
  const ent = isRide ? entranceMeta(poi) : null;
  const rows = isRide && eligibility ? eligibility.explain(identityOf(poi)) : [];

  // Contribution entries arrive as { id, authorId, line }; ride reports and
  // any legacy string stay lines without a Thanks target.
  const overlayLines = overlayCompletions.map((c, i) =>
    typeof c === 'string' ? { id: `line-${i}`, authorId: null, line: c } : c,
  );
  if (status?.report) {
    const who = status.report.byName || 'Someone';
    overlayLines.push({
      id: 'ride-report',
      authorId: null,
      line: status.report.status === 'down' ? `${who} reported it down` : `${who} reported it running`,
    });
  }

  return (
    <div className="poiDetail">
      {showActions && (
        <PlaceActions
          poi={poi}
          onNavigate={onNavigate}
          onSetMeet={onSetMeet}
          onAddToPlan={onAddToPlan}
        />
      )}
      {showStatus && status.detail && (
        <p className={`poiNote wxWhy ${status.tone}`}>
          {status.detail}
          {status.source === 'weather' && ' — a guess from the forecast, not the park'}
        </p>
      )}
      {/* Who can get on, one line each, in three columns: the person, the
          answer, and the rule that produced it. It was a paragraph per person
          reading "Maya: Riders must be at least 54\" tall", which puts three
          different kinds of thing on one line and makes the party impossible to
          scan — the answer is the column you read down, and it could only be
          found by reading each sentence to its verb.

          `explain` already returns the party most-restrictive-first, so the
          person who cannot ride is the first line rather than a line somewhere
          in the middle. Advisory and unknown keep their own rows: the twin has
          three buckets and this app has five, and collapsing "the venue never
          published a rule" into "can ride" is a claim nobody made. */}
      {rows.length > 0 && (
        <ul className="eligRows">
          {rows.map((row) => {
            const v = VERDICT[row.kind] || null;
            return (
              <li key={row.id} className="eligRow">
                <b className="eligWho">{row.name}</b>
                <span className={`eligVerdict ${v?.cls || ''}`}>{v?.label || ''}</span>
                {/* Keeps .eligibilityReason: that is the class the browser
                    suite reads this text through, and the text has not
                    changed — only the box around it. */}
                <span className="eligWhy eligibilityReason">{row.reasons?.[0] || ''}</span>
              </li>
            );
          })}
        </ul>
      )}
      {poi.note && <p className="poiNote">{poi.note}</p>}
      {camp.length > 0 && (
        <ul className="campChips">
          {camp.map((chip) => (
            <li key={chip}>{chip}</li>
          ))}
        </ul>
      )}
      {poi.approx && (
        <p className="poiNote">Position approximate — not mapped in OpenStreetMap.</p>
      )}
      {ent && (
        <p className={`poiNote entranceNote ${ent.confirmed ? 'confirmed' : 'approx'}`}>
          {ent.confirmed ? 'Queue entrance on map' : ent.hint}
        </p>
      )}
      {overlayLines.length > 0 && (
        <ul className="overlayCompletions" data-overlay-completions>
          {overlayLines.map((c) => {
            // The Death Stranding like: thank the finder of somebody else's
            // fact, once per phone. Your own finds have no button to press.
            const canThank = Boolean(
              session?.userId && c.id && c.authorId && c.authorId !== session.userId,
            );
            const done = thanked.has(c.id);
            return (
              <li key={c.id} className="poiNote overlayCompletion">
                <span className="overlayCompletionLine">{c.line}</span>
                {canThank ? (
                  <button
                    type="button"
                    className={`thanksBtn ${done ? 'on' : ''}`}
                    disabled={done}
                    data-thanks={c.id}
                    onClick={async () => {
                      await sendThanks({ contributionId: c.id, thankerId: session.userId });
                      setThanked(thankedIds());
                    }}
                  >
                    <Icon name="sparkles" size={13} /> {done ? 'Thanked' : 'Thanks'}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {poi.tel && (
        <a className="poiTel" href={`tel:${poi.tel.replace(/[^\d+]/g, '')}`}>
          <Icon name="phone.fill" size={15} />
          {poi.tel}
        </a>
      )}
      {onReport && isRide && (
        <div className="joinRow reportRow">
          <button
            type="button"
            data-report={RIDE_DOWN}
            className={`btn small ${status?.report?.status === RIDE_DOWN ? 'on' : ''}`}
            onClick={() => onReport(poi.id, status?.report?.status === RIDE_DOWN ? null : RIDE_DOWN)}
            aria-pressed={status?.report?.status === RIDE_DOWN}
          >
            {status?.report?.status === RIDE_DOWN ? 'Reported down' : 'It\u2019s down'}
          </button>
          <button
            type="button"
            data-report={RIDE_OPEN}
            className={`btn small ${status?.report?.status === RIDE_OPEN ? 'on' : ''}`}
            onClick={() => onReport(poi.id, status?.report?.status === RIDE_OPEN ? null : RIDE_OPEN)}
            aria-pressed={status?.report?.status === RIDE_OPEN}
          >
            {status?.report?.status === RIDE_OPEN ? 'Reported running' : 'It\u2019s running'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The Place's own screen: who it is, how far, whether it is running, who in
 * the party can get on it, and the three things you came here to do.
 *
 * Read top to bottom, in the order the questions arrive. The eyebrow answers
 * "is it running" before the name has even been read, because that is the one
 * fact that can make the rest of the screen pointless. The name is the biggest
 * thing on it. The line under it is where and how far. Then the actions, in
 * words — this is the screen with room for words, and the first place in the
 * app where the three glyphs the list uses can be learned.
 *
 * It is a pushed view rather than a block at the foot of the browse list. The
 * twin inlines it because the prototype has no navigation; this app has a nav
 * stack, a back chevron and a sheet height measured for this screen, and all
 * three depend on it being pushed.
 *
 * No photo. The twin draws a dashed "Photo — {name} entrance" box, which is a
 * note-to-self in a prototype and a permanent missing-image on every Place in
 * a shipped app. There is no place photography and no pipeline for it.
 */
export default function PlaceDetail({
  poi,
  me,
  eligibility = null,
  theme,
  weather = null,
  rides = null,
  members = null,
  now = Date.now(),
  onNavigate,
  onSetMeet,
  onReport = null,
  onAddToPlan = null,
  // Whether this Place is already one of today's stops — the Plan is a set, so
  // the button says so rather than letting a second tap look like a second copy.
  inPlan = false,
  overlayCompletions = [],
  session = null,
}) {
  const palette = paletteFor(theme);
  const venue = useVenueSelector((s) => s.venue);
  const map = useVenueSelector((s) => s.map);

  const status = useMemo(() => {
    if (!poi) return null;
    if (!isRideable(poi) && poi.c !== 'show') return null;
    if (!weather && !rides && !me) return null;
    const metres = me ? distance(me.lat, me.lng, poi.lat, poi.lng) : null;
    return liveFor(poi, rides?.[poi.id] ?? null, weather, now, {
      metres,
      membersNear: membersAt(poi, members),
    });
  }, [poi, weather, rides, now, me, members]);

  if (!poi) {
    return <p className="fine">Tap a place on the map to see it here.</p>;
  }

  const isRide = isRideable(poi);
  const kind = isRide ? eligibility?.at(identityOf(poi))?.kind : null;
  const v = (kind && VERDICT[kind]) || { label: '', cls: '', icon: null };
  const d = me ? distance(me.lat, me.lng, poi.lat, poi.lng) : null;
  const dir = me && d != null ? cardinal(bearing(me.lat, me.lng, poi.lat, poi.lng)) : null;
  const showStatus = Boolean(status?.label);
  const context = placeContext(poi, venue, map);
  const subtitle = [
    isRide ? heightLabel(poi) : CATEGORY_LABELS[poi.c] || poi.c,
    context ? `${context.kind === 'zone' ? WORDS.zone : WORDS.world} · ${context.name}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className={`placeDetail ${v.cls}`}
      data-place-detail={poi.id || poi.n}
      data-overlay={poi.overlay ? '1' : undefined}
    >
      <div className="placeDetailHead">
        {/* The live word, above the name and in the colour of what it means.
            The twin colours this by category, which is decorative — a coaster
            is orange whether it is running or stopped. Tone is the same three
            inks the status pill and the weather note already use, so "PAUSED"
            is red here for the same reason it is red everywhere else. */}
        {showStatus && (
          <span className={`placeEyebrow ${status.tone || ''}`}>
            <i aria-hidden="true">{status.source === 'party' ? '\u25CF' : '\u2601'}</i>
            {status.label}
          </span>
        )}
        <b className="placeDetailName">
          <span
            className="dot"
            style={{ background: v.cls === 'bad' ? palette.barred : palette.categories[poi.c] }}
          />
          {poi.n}
        </b>
        <span className="placeDetailLine">
          {subtitle}
          {d != null && (
            <>
              {subtitle ? ' · ' : ''}
              <b>{formatWalk(d)}</b>
              {` ${formatDistance(d)}${dir ? ` ${dir}` : ''}`}
            </>
          )}
          {/* The verdict stays on this line rather than joining the eyebrow:
              whether a ride is running and whether your party can get on it are
              two different questions, and the app has never let them share a
              pill. */}
          {v.label && (
            <span className={`verdict ${v.cls}`}>
              <i aria-hidden="true">{v.icon && <Icon name={v.icon} size={12} />}</i>
              {v.label}
            </span>
          )}
        </span>
      </div>

      <PlaceActions
        poi={poi}
        onNavigate={onNavigate}
        onSetMeet={onSetMeet}
        onAddToPlan={onAddToPlan}
        labelled
        inPlan={inPlan}
      />

      <PlaceDetailBody
        poi={poi}
        status={status}
        venue={venue}
        eligibility={eligibility}
        onNavigate={onNavigate}
        onSetMeet={onSetMeet}
        onReport={onReport}
        onAddToPlan={onAddToPlan}
        showActions={false}
        overlayCompletions={overlayCompletions}
        session={session}
      />
    </div>
  );
}
