'use client';

import { useMemo, useState } from 'react';
import { CATEGORY_LABELS, paletteFor } from '@/lib/theme';
import { POIS, eligibility, heightLabel } from '@/lib/park';
import { distance, formatDistance, formatWalk } from '@/lib/geo';

/* The height requirement is the thing a family checks twenty times a day, so it
   gets the top of the panel: tap a tier, read the bar, scan the list. The
   slider stays for a precise number but is no longer the only way in. */

const TIERS = [36, 40, 42, 46, 48, 52, 54];

const VERDICT = {
  yes: { label: 'Can ride', cls: 'ok', mark: '\u2713' },
  companion: { label: 'With adult', cls: 'warn', mark: '\u2713' },
  no: { label: 'Too short', cls: 'bad', mark: '\u2715' },
  toobig: { label: 'Too tall', cls: 'bad', mark: '\u2715' },
  unknown: { label: '', cls: '', mark: '' },
};

export default function RidesPanel({
  me,
  height,
  withAdult,
  onHeight,
  onWithAdult,
  selected,
  onSelect,
  onSetMeet,
  onNavigate,
  theme,
}) {
  const palette = paletteFor(theme);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('coaster');
  const [onlyRideable, setOnlyRideable] = useState(false);

  const counts = useMemo(() => {
    if (height == null) return null;
    const tally = { yes: 0, companion: 0, no: 0 };
    POIS.forEach((p) => {
      if (p.c !== 'coaster' && p.c !== 'ride') return;
      const v = eligibility(p, height, withAdult);
      if (v === 'yes') tally.yes += 1;
      else if (v === 'companion') tally.companion += 1;
      else tally.no += 1;
    });
    return tally;
  }, [height, withAdult]);

  // What the next tier would buy — the question behind "is it worth waiting
  // until next summer".
  const nextUnlock = useMemo(() => {
    if (height == null) return null;
    const next = TIERS.find((t) => t > height);
    if (!next) return null;
    let gained = 0;
    POIS.forEach((p) => {
      if (p.c !== 'coaster' && p.c !== 'ride') return;
      const now = eligibility(p, height, withAdult);
      const then = eligibility(p, next, withAdult);
      if ((now === 'no' || now === 'toobig') && (then === 'yes' || then === 'companion')) {
        gained += 1;
      }
    });
    return gained > 0 ? { at: next, gained } : null;
  }, [height, withAdult]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = POIS.filter((p) => {
      if (filter !== 'all' && p.c !== filter) return false;
      if (q && !p.n.toLowerCase().includes(q) && !p.a.toLowerCase().includes(q)) return false;
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
  }, [query, filter, onlyRideable, height, withAdult, me]);

  return (
    <div>
      <div className="label">
        Rider height
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

      <div className="heightRow">
        <input
          type="range"
          min="30"
          max="76"
          step="1"
          style={{ '--pct': `${(((height ?? 48) - 30) / 46) * 100}%` }}
          value={height ?? 48}
          onChange={(e) => onHeight(Number(e.target.value))}
          aria-label="Rider height in inches"
        />
        <div className="heightVal">
          <b>{height ?? '\u2013'}</b>
          <span>in</span>
        </div>
      </div>

      {counts ? (
        <>
          <div
            className="ratioBar"
            role="img"
            aria-label={`${counts.yes} rides open, ${counts.companion} with an adult, ${counts.no} closed`}
          >
            <span className="seg ok" style={{ flexGrow: counts.yes || 0.001 }} />
            <span className="seg warn" style={{ flexGrow: counts.companion || 0.001 }} />
            <span className="seg bad" style={{ flexGrow: counts.no || 0.001 }} />
          </div>
          <div className="ratioKey">
            <span className="ok">
              <b>{counts.yes}</b> open
            </span>
            <span className="warn">
              <b>{counts.companion}</b> with adult
            </span>
            <span className="bad">
              <b>{counts.no}</b> closed
            </span>
          </div>
          {nextUnlock && (
            <p className="unlock">
              <b>{nextUnlock.gained} more</b> open up at {nextUnlock.at}&quot;
            </p>
          )}
        </>
      ) : (
        <p className="fine" style={{ marginTop: 0 }}>
          Pick a height to see what a rider can get on. Anything they can&apos;t ride
          fades out on the map too.
        </p>
      )}

      <div className="chips">
        <button
          type="button"
          className={`chip ${withAdult ? 'on' : ''}`}
          onClick={() => onWithAdult(!withAdult)}
          aria-pressed={withAdult}
        >
          Adult along
        </button>
        <button
          type="button"
          className={`chip ${onlyRideable ? 'on' : ''}`}
          onClick={() => setOnlyRideable(!onlyRideable)}
          aria-pressed={onlyRideable}
        >
          Only what they can ride
        </button>
      </div>

      <div className="label">Find a place</div>
      <input
        className="field"
        placeholder="Search the park"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search the park"
      />

      <div className="chips">
        <button
          type="button"
          className={`chip ${filter === 'all' ? 'on' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, labelText]) => (
          <button
            key={key}
            type="button"
            className={`chip withDot ${filter === key ? 'on' : ''}`}
            onClick={() => setFilter(key)}
          >
            <i style={{ background: palette.categories[key] }} />
            {labelText}
          </button>
        ))}
      </div>

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
                      <i aria-hidden="true">{v.mark}</i>
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

      <p className="fine">
        Heights were compiled from Kings Island Central and Theme Park Insider for the
        2026 season. The ride operator measures at the gate and has the final say.
      </p>
    </div>
  );
}
