'use client';

import { useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import { RIDE_DOWN, RIDE_OPEN } from '@/lib/core/state';
import { statusFor } from '@/lib/rideStatus';
import { CATEGORY_LABELS, paletteFor } from '@/lib/theme';
import { eligibility, heightLabel } from '@/lib/park';
import { usePois } from '@/lib/venue/useVenue';
import { categoriesFor, matchedByName, matchesQuery } from '@/lib/search';
import { distance, formatDistance, formatWalk } from '@/lib/geo';

/* The results, the way a phone map shows them: a row of category filters and
   then a list, nearest first. It is the same surface whether you typed
   something or tapped a category — searching a map is not a separate mode.

   Two different questions land on the same row and must never be confused:
   whether a rider is *allowed* on, which is the height screen's business and
   arrives here as a verdict, and whether the ride is *running*, which is this
   screen's own. They get separate words and separate pills. Running status is
   independent of heights, so it shows on a venue that publishes none. */

const VERDICT = {
  yes: { label: 'Can ride', cls: 'ok', icon: 'checkmark' },
  companion: { label: 'With adult', cls: 'warn', icon: 'checkmark' },
  no: { label: 'Too short', cls: 'bad', icon: 'xmark' },
  toobig: { label: 'Too tall', cls: 'bad', icon: 'xmark' },
  unknown: { label: '', cls: '', icon: null },
};

export default function PlaceList({
  me,
  height,
  withAdult,
  query,
  filter,
  onFilter,
  onlyRideable,
  onOnlyRideable,
  selected,
  onSelect,
  onSetMeet,
  onNavigate,
  theme,
  // Live status. All optional: with none of them this is exactly the place
  // list it has always been.
  weather = null,
  rides = null, // the party's report map, keyed by ride id
  onReport = null, // (rideId, 'down'|'open'|null) — null when not in a party
  now = Date.now(),
}) {
  const palette = paletteFor(theme);
  const POIS = usePois();
  const [onlyRunning, setOnlyRunning] = useState(false);

  // One verdict per place, computed once. `now` is a prop rather than a call so
  // the whole screen agrees on what "12 min ago" means within a render.
  const statuses = useMemo(() => {
    const out = new Map();
    if (!weather && !rides) return out;
    POIS.forEach((p) => {
      if (p.c !== 'coaster' && p.c !== 'ride' && p.c !== 'show') return;
      out.set(p.id, statusFor(p, rides?.[p.id] ?? null, weather, now));
    });
    return out;
  }, [POIS, weather, rides, now]);

  // Which categories the words themselves are asking for — computed once per
  // query rather than once per place.
  const queryCats = useMemo(() => categoriesFor(query), [query]);

  const list = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    let out = POIS.filter((p) => {
      if (filter !== 'all' && p.c !== filter) return false;
      if (!matchesQuery(p, q, queryCats)) return false;
      if (onlyRideable && height != null && (p.c === 'coaster' || p.c === 'ride')) {
        const v = eligibility(p, height, withAdult);
        if (v === 'no' || v === 'toobig') return false;
      }
      if (onlyRunning) {
        // Hides what is probably not running. Deliberately keeps `watch` —
        // that is a maybe, and hiding a maybe loses a ride the family could
        // have got on between showers.
        const st = statuses.get(p.id);
        if (st && (st.tone === 'bad' || st.key === 'hold')) return false;
      }
      return true;
    });
    /* Nearest first, but a place that answers by name comes before the
       category it merely belongs to. Without the first term, typing "atm"
       sorts the nearest first-aid hut above the cash machine that is actually
       called one. */
    const named = new Map(out.map((p) => [p, q && matchedByName(p, q) ? 0 : 1]));
    const byName = (a, b) => named.get(a) - named.get(b);
    out = me
      ? [...out].sort(
          (a, b) =>
            byName(a, b) ||
            distance(me.lat, me.lng, a.lat, a.lng) - distance(me.lat, me.lng, b.lat, b.lng),
        )
      : [...out].sort((a, b) => byName(a, b) || a.n.localeCompare(b.n));
    return out.slice(0, 120);
  }, [POIS, query, queryCats, filter, onlyRideable, onlyRunning, statuses, height, withAdult, me]);

  return (
    <div>
      <div className="chips">
        <button
          type="button"
          className={`chip ${filter === 'all' ? 'on' : ''}`}
          onClick={() => onFilter('all')}
        >
          All
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, labelText]) => (
          <button
            key={key}
            type="button"
            className={`chip withDot ${filter === key ? 'on' : ''}`}
            onClick={() => onFilter(key)}
          >
            <i style={{ background: palette.categories[key] }} />
            {labelText}
          </button>
        ))}
      </div>

      {(height != null || statuses.size > 0) && (
        <div className="chips">
          {height != null && (
            <button
              type="button"
              className={`chip ${onlyRideable ? 'on' : ''}`}
              onClick={() => onOnlyRideable(!onlyRideable)}
              aria-pressed={onlyRideable}
            >
              Only what they can ride
            </button>
          )}
          {/* Separate from the height filter on purpose: whether a ride is
              running has nothing to do with whether a venue publishes height
              rules. */}
          {statuses.size > 0 && (
            <button
              type="button"
              className={`chip ${onlyRunning ? 'on' : ''}`}
              onClick={() => setOnlyRunning(!onlyRunning)}
              aria-pressed={onlyRunning}
            >
              Hide what&apos;s likely down
            </button>
          )}
        </div>
      )}

      <div className="poiList">
        {list.length === 0 &&
          (filter !== 'all' ? (
            /* The commonest way to see nothing is to be looking at one
               category and not know it, so the way out is offered here rather
               than left to be discovered in the chip row above. */
            <div className="emptyNote">
              <p className="fine">
                Nothing in {CATEGORY_LABELS[filter]?.toLowerCase() || 'that'} matches
                {query ? ` “${query.trim()}”` : ' that'}.
              </p>
              <button type="button" className="btn small" onClick={() => onFilter('all')}>
                Search every place instead
              </button>
            </div>
          ) : (
            <p className="fine">
              Nothing in this park is called that. Try a ride&apos;s name, or a word like
              “toilet”, “food” or “first aid”.
            </p>
          ))}
        {list.map((p) => {
          const isRide = p.c === 'coaster' || p.c === 'ride';
          const verdict = isRide ? eligibility(p, height, withAdult) : 'unknown';
          const v = VERDICT[verdict];
          const d = me ? distance(me.lat, me.lng, p.lat, p.lng) : null;
          const open = selected && selected.n === p.n;
          const st = statuses.get(p.id) || null;
          const showStatus = Boolean(st && st.label);
          return (
            <div key={p.id} className={`poiRow ${open ? 'open' : ''} ${v.cls}`}>
              <button
                type="button"
                className="poiMain"
                onClick={() => onSelect(p)}
                aria-expanded={Boolean(open)}
              >
                <span className="dot" style={{ background: palette.categories[p.c] }} />
                <span className="poiText">
                  <b>{p.n}</b>
                  <span>
                    {isRide ? heightLabel(p) : CATEGORY_LABELS[p.c]} · {p.a}
                  </span>
                </span>
                <span className="poiRight">
                  {d != null && (
                    <span className="poiWalk">
                      <b>{formatWalk(d)}</b>
                      <em>{formatDistance(d)}</em>
                    </span>
                  )}
                  {showStatus && (
                    <span
                      className={`verdict statusPill ${st.tone} ${st.source === 'weather' ? 'guess' : ''}`}
                    >
                      <i aria-hidden="true">{st.source === 'party' ? '\u25CF' : '\u2601'}</i>
                      {st.label}
                    </span>
                  )}
                  {v.label && (
                    <span className={`verdict ${v.cls}`}>
                      <i aria-hidden="true">{v.icon && <Icon name={v.icon} size={12} />}</i>
                      {v.label}
                    </span>
                  )}
                </span>
              </button>
              {open && (
                <div className="poiDetail">
                  {showStatus && st.detail && (
                    <p className={`poiNote wxWhy ${st.tone}`}>
                      {st.detail}
                      {st.source === 'weather' && ' — a guess from the forecast, not the park'}
                    </p>
                  )}
                  {p.note && <p className="poiNote">{p.note}</p>}
                  {p.approx && (
                    <p className="poiNote">Position approximate — not mapped in OpenStreetMap.</p>
                  )}
                  {onReport && isRide && (
                    <div className="joinRow reportRow">
                      {/* Reporting is one tap and instantly retractable. Anything
                          slower and nobody does it while walking past. */}
                      <button
                        type="button"
                        data-report={RIDE_DOWN}
                        className={`btn small ${st?.report?.status === RIDE_DOWN ? 'on' : ''}`}
                        onClick={() => onReport(p.id, st?.report?.status === RIDE_DOWN ? null : RIDE_DOWN)}
                        aria-pressed={st?.report?.status === RIDE_DOWN}
                      >
                        {st?.report?.status === RIDE_DOWN ? 'Reported down' : 'It\u2019s down'}
                      </button>
                      <button
                        type="button"
                        data-report={RIDE_OPEN}
                        className={`btn small ${st?.report?.status === RIDE_OPEN ? 'on' : ''}`}
                        onClick={() => onReport(p.id, st?.report?.status === RIDE_OPEN ? null : RIDE_OPEN)}
                        aria-pressed={st?.report?.status === RIDE_OPEN}
                      >
                        {st?.report?.status === RIDE_OPEN ? 'Reported running' : 'It\u2019s running'}
                      </button>
                    </div>
                  )}
                  <div className="joinRow">
                    <button
                      type="button"
                      className="btn small primary"
                      onClick={() => onNavigate({ kind: 'poi', label: p.n, lat: p.lat, lng: p.lng })}
                    >
                      Walk me there
                    </button>
                    <button type="button" className="btn small" onClick={() => onSetMeet(p)}>
                      Make this the meet-up
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {statuses.size > 0 && (
        <p className="fine">
          Running status is your party&apos;s own reports plus what the forecast implies
          &mdash; not a feed from the park. Treat &ldquo;likely&rdquo; as likely.
          {onReport
            ? ' Tap a place and tell the party what you see.'
            : ' Start or join a party to report what you see.'}
        </p>
      )}
    </div>
  );
}
