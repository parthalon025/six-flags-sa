'use client';

import { useMemo } from 'react';
import Icon from '@/components/Icon';
import { RIDE_DOWN, RIDE_OPEN } from '@/lib/core/state';
import { liveFor, membersAt } from '@/lib/live';
import { CATEGORY_LABELS, paletteFor } from '@/lib/theme';
import { eligibilityWithReasons, heightLabel, isRideable } from '@/lib/park';
import { useVenueSelector } from '@/lib/venue/useVenue';
import { campChips, campDetails } from '@/lib/camping';
import { entranceMeta } from '@/lib/entrance';
import { bearing, cardinal, distance, formatDistance, formatWalk } from '@/lib/geo';
import { WORDS } from '@/lib/brand';

/**
 * The open face of a place: notes, camp checklist, phone, ride status, and the
 * two things you came here to do — walk there, or make it the meet-up.
 * Shared by the list's expanded row and the sheet that opens from a map tap.
 */
export function PlaceDetailBody({
  poi,
  status = null,
  venue = null,
  onNavigate,
  onSetMeet,
  onReport = null,
  onAddToPlan = null,
}) {
  if (!poi) return null;
  const isRide = isRideable(poi);
  const showStatus = Boolean(status?.label);
  const camp = campChips(campDetails(poi, venue));
  const ent = isRide ? entranceMeta(poi) : null;

  return (
    <div className="poiDetail">
      {showStatus && status.detail && (
        <p className={`poiNote wxWhy ${status.tone}`}>
          {status.detail}
          {status.source === 'weather' && ' — a guess from the forecast, not the park'}
        </p>
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
      <div className="joinRow">
        <button
          type="button"
          className="btn small primary iconOnly"
          onClick={() => onNavigate({ kind: 'poi', label: poi.n, lat: poi.lat, lng: poi.lng })}
          aria-label={WORDS.navigation}
        >
          <Icon name="location.fill" size={18} />
        </button>
        <button type="button" className="btn small" onClick={() => onSetMeet(poi)}>
          Make this the meet-up
        </button>
        {onAddToPlan && (
          <button type="button" className="btn small" onClick={() => onAddToPlan(poi)}>
            Save
          </button>
        )}
      </div>
    </div>
  );
}

const VERDICT = {
  yes: { label: 'Can ride', cls: 'ok', icon: 'checkmark' },
  companion: { label: 'With adult', cls: 'warn', icon: 'checkmark' },
  advisory: { label: 'Advisory', cls: 'warn', icon: 'checkmark' },
  no: { label: 'Too short', cls: 'bad', icon: 'xmark' },
  toobig: { label: 'Too tall', cls: 'bad', icon: 'xmark' },
  unknown: { label: '', cls: '', icon: null },
};

/**
 * Full place sheet opened from a map icon: who it is, how far, what is known
 * about it, and a compact navigate control — the same answers the list expands
 * to, without requiring the visitor to find the row first.
 */
export default function PlaceDetail({
  poi,
  me,
  height,
  withAdult,
  theme,
  weather = null,
  rides = null,
  members = null,
  now = Date.now(),
  onNavigate,
  onSetMeet,
  onReport = null,
  onAddToPlan = null,
}) {
  const palette = paletteFor(theme);
  const venue = useVenueSelector((s) => s.venue);

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
  const check = isRide ? eligibilityWithReasons(poi, height, withAdult) : null;
  const verdict = check ? check.raw : 'unknown';
  const v = VERDICT[verdict];
  const reason = check?.reasons?.[0] || null;
  const d = me ? distance(me.lat, me.lng, poi.lat, poi.lng) : null;
  const dir = me && d != null ? cardinal(bearing(me.lat, me.lng, poi.lat, poi.lng)) : null;
  const showStatus = Boolean(status?.label);

  return (
    <div className={`placeDetail ${v.cls}`} data-place-detail={poi.id || poi.n}>
      <div className="placeDetailHead">
        <span
          className="dot"
          style={{ background: v.cls === 'bad' ? palette.barred : palette.categories[poi.c] }}
        />
        <div className="placeDetailText">
          <b className="placeDetailName">{poi.n}</b>
          <span>
            {isRide ? heightLabel(poi) : CATEGORY_LABELS[poi.c] || poi.c}
            {poi.a ? ` · ${poi.a}` : ''}
          </span>
        </div>
      </div>

      <div className="placeDetailMeta">
        {d != null && (
          <span className="placeDetailWalk">
            <b>{formatWalk(d)}</b>
            <em>
              {formatDistance(d)}
              {dir ? ` ${dir}` : ''}
            </em>
          </span>
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
      </div>

      {reason && <p className="poiNote eligibilityReason">{reason}</p>}

      <PlaceDetailBody
        poi={poi}
        status={status}
        venue={venue}
        onNavigate={onNavigate}
        onSetMeet={onSetMeet}
        onReport={onReport}
        onAddToPlan={onAddToPlan}
      />
    </div>
  );
}
