'use client';

import { useMemo } from 'react';
import Icon from '@/components/Icon';
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

/**
 * Walk / Rally / Plan — the same glyphs as the map FAB and the Plan tab,
 * so the actions can be learned as icons rather than re-read as words.
 */
export function PlaceActions({ poi, onNavigate, onSetMeet, onAddToPlan = null }) {
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
}) {
  if (!poi) return null;
  const isRide = isRideable(poi);
  const showStatus = Boolean(status?.label);
  const camp = campChips(campDetails(poi, venue));
  const ent = isRide ? entranceMeta(poi) : null;
  const rows = isRide && eligibility ? eligibility.explain(identityOf(poi)) : [];

  const overlayLines = [...overlayCompletions];
  if (status?.report) {
    const who = status.report.byName || 'Someone';
    overlayLines.push(
      status.report.status === 'down' ? `${who} reported it down` : `${who} reported it running`,
    );
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
      {rows.map((row) => {
        const text = row.reasons?.[0];
        if (!text) return null;
        return (
          <p key={row.id} className="poiNote eligibilityReason">
            {rows.length > 1 ? `${row.name}: ${text}` : text}
          </p>
        );
      })}
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
          {overlayLines.map((line, i) => (
            <li key={`${i}:${line}`} className="poiNote overlayCompletion">
              {line}
            </li>
          ))}
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

const VERDICT = {
  eligible: { label: 'Can ride', cls: 'ok', icon: 'checkmark' },
  companion: { label: 'With adult', cls: 'warn', icon: 'checkmark' },
  advisory: { label: 'Advisory', cls: 'warn', icon: 'checkmark' },
  not: { label: 'Too short', cls: 'bad', icon: 'xmark' },
  unknown: { label: 'Unknown', cls: 'unknown', icon: null },
};

/**
 * Full place sheet opened from a map icon: who it is, how far, what is known
 * about it, and a compact navigate control — the same answers the list expands
 * to, without requiring the visitor to find the row first.
 *
 * Laid out like a Maps collapsed card: name, one line of facts, icon actions.
 * Notes and reports sit below so a lean sheet still shows the things you came
 * to do; pull up to read the rest.
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
  overlayCompletions = [],
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
        <span
          className="dot"
          style={{ background: v.cls === 'bad' ? palette.barred : palette.categories[poi.c] }}
        />
        <div className="placeDetailText">
          <b className="placeDetailName">{poi.n}</b>
          <span className="placeDetailLine">
            {subtitle}
            {d != null && (
              <>
                {subtitle ? ' · ' : ''}
                <b>{formatWalk(d)}</b>
                {` ${formatDistance(d)}${dir ? ` ${dir}` : ''}`}
              </>
            )}
            {showStatus && (
              <span
                className={[
                  'liveBadge',
                  'statusPill',
                  status.live === 'goNow' || status.key === 'goNow' ? 'goNow' : '',
                  status.live === 'busy' || status.key === 'busy' ? 'busy' : '',
                  status.live === 'later' || status.key === 'later' || status.key === 'watch'
                    ? 'later'
                    : '',
                  status.live === 'open' || status.key === 'open' ? 'open' : '',
                  status.live === 'paused' ||
                  status.key === 'down' ||
                  status.key === 'hold' ||
                  status.key === 'paused'
                    ? 'paused'
                    : '',
                  status.live === 'weather' || status.key === 'closed' ? 'weather' : '',
                  status.source === 'weather' ? 'guess' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <i aria-hidden="true">{status.source === 'party' ? '\u25CF' : '\u2601'}</i>
                {status.label}
              </span>
            )}
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
        />
      </div>

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
      />
    </div>
  );
}
