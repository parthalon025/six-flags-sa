'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import { liveFor, membersAt } from '@/lib/live';
import { CATEGORY_LABELS, paletteFor } from '@/lib/theme';
import {
  categoriesFor,
  heightLabel,
  isRideable,
  matchedByName,
  matchesQuery,
} from '@/lib/park';
import { usePois, useVenueSelector } from '@/lib/venue/useVenue';
import { identityOf, samePlace } from '@/lib/venue/ids';
import { campDetails, campSearchText } from '@/lib/camping';
import { distance, formatDistance, formatWalk } from '@/lib/geo';
import { PlaceDetailBody } from '@/components/PlaceDetail';

/* The results, the way a phone map shows them: a row of category filters and
   then a list, nearest first. It is the same surface whether you typed
   something or tapped a category — searching a map is not a separate mode.

   Two different questions land on the same row and must never be confused:
   whether a rider is *allowed* on, which is the height screen's business and
   arrives here as a verdict, and whether the ride is *running*, which is this
   screen's own. They get separate words and separate pills. Running status is
   independent of heights, so it shows on a venue that publishes none. */

const VERDICT = {
  eligible: { label: 'Can ride', cls: 'ok', icon: 'checkmark' },
  companion: { label: 'With adult', cls: 'warn', icon: 'checkmark' },
  advisory: { label: 'Advisory', cls: 'warn', icon: 'checkmark' },
  not: { label: 'Too short', cls: 'bad', icon: 'xmark' },
};

export default function PlaceList({
  me,
  eligibility,
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
  onAddToPlan = null,
  now = Date.now(),
  members = null, // party members for BUSY clustering
}) {
  const palette = paletteFor(theme);
  const POIS = usePois();
  // The venue, for the half of a campsite's details that belong to the whole
  // campground rather than to one pitch.
  const venue = useVenueSelector((s) => s.venue);
  const [onlyRunning, setOnlyRunning] = useState(false);

  const ROW_H = 52;
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);
  const listRef = useRef(null);

  // One live verdict per place. Distance and party clustering turn OPEN into
  // GO NOW / BUSY without inventing a wait-time number.
  const statuses = useMemo(() => {
    const out = new Map();
    if (!weather && !rides && !me) return out;
    POIS.forEach((p) => {
      if (!isRideable(p) && p.c !== 'show') return;
      const metres = me ? distance(me.lat, me.lng, p.lat, p.lng) : null;
      const near = membersAt(p, members);
      out.set(
        p.id,
        liveFor(p, rides?.[p.id] ?? null, weather, now, {
          metres,
          membersNear: near,
        }),
      );
    });
    return out;
  }, [POIS, weather, rides, now, me, members]);

  // Which categories the words themselves are asking for — computed once per
  // query rather than once per place.
  const queryCats = useMemo(() => categoriesFor(query), [query]);

  /** Which categories this venue has any of, for the chip row. */
  const present = useMemo(() => new Set(POIS.map((p) => p.c)), [POIS]);

  /* What a campsite offers, as words a query can hit. Every pitch is called
     "Site 247", so without this "50 amp" and "full hookup" — the two things
     somebody towing actually searches for — match nothing anywhere. */
  const campFacets = useMemo(() => {
    const out = new Map();
    POIS.forEach((p) => {
      if (p.c !== 'campsite') return;
      const text = campSearchText(campDetails(p, venue));
      if (text) out.set(p.id, text);
    });
    return out;
  }, [POIS, venue]);

  const list = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    let out = POIS.filter((p) => {
      if (filter !== 'all' && p.c !== filter) return false;
      if (!matchesQuery(p, q, queryCats, campFacets)) return false;
      if (onlyRideable && isRideable(p) && eligibility?.at(identityOf(p))?.blocks) {
        return false;
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
    /* A bound on how much markup one screen can be asked to hold, not an
       editorial cut. It has to sit above the largest venue's whole place list
       or the tail of the park quietly stops existing — and a category filter
       that removes fewer places than the cap hides then looks like it did
       nothing at all. */
    return out.slice(0, 400);
  }, [POIS, query, queryCats, campFacets, filter, onlyRideable, onlyRunning, statuses, eligibility, me]);

  const useVirtual = list.length > 50;
  const visibleStart = Math.floor(scrollTop / ROW_H);
  const visibleCount = Math.ceil(containerHeight / ROW_H) + 2;
  const visibleItems = useVirtual ? list.slice(visibleStart, visibleStart + visibleCount) : list;

  useEffect(() => {
    if (!useVirtual) return undefined;
    const listEl = listRef.current;
    if (!listEl) return undefined;
    const scrollEl = listEl.closest('.sheetBody');
    if (!scrollEl) return undefined;

    const offsetWithin = (el, ancestor) => {
      let top = 0;
      let node = el;
      while (node && node !== ancestor) {
        top += node.offsetTop;
        node = node.parentElement;
      }
      return top;
    };

    const update = () => {
      const listTop = offsetWithin(listEl, scrollEl);
      setScrollTop(Math.max(0, scrollEl.scrollTop - listTop));
      setContainerHeight(scrollEl.clientHeight);
    };

    scrollEl.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scrollEl);
    update();
    return () => {
      scrollEl.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [useVirtual, list.length]);

  const renderRow = (p) => {
    const isRide = isRideable(p);
    const kind = isRide ? eligibility?.at(identityOf(p))?.kind : null;
    const v = (kind && VERDICT[kind]) || { label: '', cls: '', icon: null };
    const d = me ? distance(me.lat, me.lng, p.lat, p.lng) : null;
    const open = selected && samePlace(selected, p);
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
          {/* A ruled-out ride takes the same red here as it does on the
              map, rather than its category colour dimmed — the list and
              the map are two views of one answer, and a visitor who has
              learnt the red on one should not have to learn a fade on
              the other. */}
          <span
            className="dot"
            style={{ background: v.cls === 'bad' ? palette.barred : palette.categories[p.c] }}
          />
          <span className="poiText">
            <b className="poiName">{p.n}</b>
            <span>
              {isRide ? heightLabel(p) : CATEGORY_LABELS[p.c]} · {p.a}
            </span>
          </span>
          <span className="poiOut">
            {d != null && (
              <span className="poiWalk">
                <b>{formatWalk(d)}</b>
                <em>{formatDistance(d)}</em>
              </span>
            )}
            {showStatus && (
              <span
                className={[
                  'liveBadge',
                  'statusPill',
                  st.live === 'goNow' || st.key === 'goNow' ? 'goNow' : '',
                  st.live === 'busy' || st.key === 'busy' ? 'busy' : '',
                  st.live === 'later' || st.key === 'later' || st.key === 'watch' ? 'later' : '',
                  st.live === 'open' || st.key === 'open' ? 'open' : '',
                  st.live === 'paused' || st.key === 'down' || st.key === 'hold' || st.key === 'paused'
                    ? 'paused'
                    : '',
                  st.live === 'weather' || st.key === 'closed' ? 'weather' : '',
                  st.source === 'weather' ? 'guess' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
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
          <PlaceDetailBody
            poi={p}
            status={st}
            venue={venue}
            eligibility={eligibility}
            onNavigate={onNavigate}
            onSetMeet={onSetMeet}
            onReport={onReport}
            onAddToPlan={onAddToPlan}
          />
        )}
      </div>
    );
  };

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
        {/* Only the categories this venue has any of — a "Camping" chip that
            filters a park with no campground down to nothing is a dead end
            dressed as a feature. */}
        {Object.entries(CATEGORY_LABELS)
          .filter(([key]) => present.has(key))
          .map(([key, labelText]) => (
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

      <div className="poiList" ref={listRef}>
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
        {useVirtual ? (
          <div style={{ height: list.length * ROW_H }}>
            <div style={{ paddingTop: visibleStart * ROW_H }}>
              {visibleItems.map((p) => renderRow(p))}
            </div>
          </div>
        ) : (
          list.map((p) => renderRow(p))
        )}
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
