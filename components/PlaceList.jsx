'use client';

import { useMemo } from 'react';
import Icon from '@/components/Icon';
import { CATEGORY_LABELS, paletteFor } from '@/lib/theme';
import { eligibility, heightLabel } from '@/lib/park';
import { usePois } from '@/lib/venue/useVenue';
import { distance, formatDistance, formatWalk } from '@/lib/geo';

/* The results, the way a phone map shows them: a row of category filters and
   then a list, nearest first. It is the same surface whether you typed
   something or tapped a category — searching a map is not a separate mode. */

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
}) {
  const palette = paletteFor(theme);
  const POIS = usePois();

  const list = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    let out = POIS.filter((p) => {
      if (filter !== 'all' && p.c !== filter) return false;
      if (q && !p.n.toLowerCase().includes(q) && !(p.a || '').toLowerCase().includes(q)) return false;
      if (onlyRideable && height != null && (p.c === 'coaster' || p.c === 'ride')) {
        const v = eligibility(p, height, withAdult);
        if (v === 'no' || v === 'toobig') return false;
      }
      return true;
    });
    out = me
      ? [...out].sort(
          (a, b) =>
            distance(me.lat, me.lng, a.lat, a.lng) - distance(me.lat, me.lng, b.lat, b.lng),
        )
      : [...out].sort((a, b) => a.n.localeCompare(b.n));
    return out.slice(0, 120);
  }, [POIS, query, filter, onlyRideable, height, withAdult, me]);

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

      {height != null && (
        <div className="chips">
          <button
            type="button"
            className={`chip ${onlyRideable ? 'on' : ''}`}
            onClick={() => onOnlyRideable(!onlyRideable)}
            aria-pressed={onlyRideable}
          >
            Only what they can ride
          </button>
        </div>
      )}

      <div className="poiList">
        {list.length === 0 && <p className="fine">Nothing matches that.</p>}
        {list.map((p) => {
          const isRide = p.c === 'coaster' || p.c === 'ride';
          const verdict = isRide ? eligibility(p, height, withAdult) : 'unknown';
          const v = VERDICT[verdict];
          const d = me ? distance(me.lat, me.lng, p.lat, p.lng) : null;
          const open = selected && selected.n === p.n;
          return (
            <div key={p.n + p.lat} className={`poiRow ${open ? 'open' : ''} ${v.cls}`}>
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
                  {p.note && <p className="poiNote">{p.note}</p>}
                  {p.approx && (
                    <p className="poiNote">Position approximate — not mapped in OpenStreetMap.</p>
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
    </div>
  );
}
