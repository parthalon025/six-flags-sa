'use client';

import { useMemo } from 'react';
import { bearing, cardinal, distance, formatAge, formatDistance, formatWalk } from '@/lib/geo';
import { navKeyOf as keyOfNav } from '@/lib/routing';
import { usePois } from '@/lib/venue/useVenue';
import { paletteFor } from '@/lib/theme';

/* The card rail is what you see without opening anything. In a park the
   question is almost always "which way, and how long", so walking time is the
   headline and the arrow is aimed relative to the way you're facing whenever
   the compass is available. */

function Arrow({ deg, colour }) {
  return (
    <svg className="glanceArrow" viewBox="0 0 24 24" aria-hidden="true">
      <g transform={`rotate(${deg} 12 12)`}>
        <path
          d="M12 3 L18.5 20 L12 15.8 L5.5 20 Z"
          fill={colour}
          stroke="var(--panel)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

function nearestOf(pois, lat, lng, predicate) {
  let best = null;
  pois.forEach((p) => {
    if (!predicate(p)) return;
    const d = distance(lat, lng, p.lat, p.lng);
    if (!best || d < best.d) best = { poi: p, d };
  });
  return best;
}

export default function GlanceRail({
  me,
  members,
  meet,
  selected,
  heading,
  theme,
  onFocus,
  onNavigate,
  navKey,
  navMetres,
  onOpenParty,
}) {
  const palette = paletteFor(theme);
  // The places are the loaded venue's, so they have to be a dependency of the
  // memo below: without it, switching venues leaves the rail pointing at the
  // restrooms of a park a thousand miles away.
  const pois = usePois();

  const cards = useMemo(() => {
    if (!me) return [];
    const out = [];
    const rel = (b) => (heading == null ? b : (b - heading + 360) % 360);

    const push = (key, eyebrow, title, target, colour, footnote, tone, nav) => {
      const d = distance(me.lat, me.lng, target.lat, target.lng);
      const b = bearing(me.lat, me.lng, target.lat, target.lng);
      out.push({
        key,
        eyebrow,
        title,
        colour,
        tone,
        walk: formatWalk(d),
        dist: formatDistance(d),
        card: cardinal(b),
        deg: rel(b),
        footnote,
        target,
        nav,
      });
    };

    if (meet) {
      push('meet', 'Meet-up', meet.label, meet, 'var(--crimson)', `set by ${meet.by}`, 'meet', {
        kind: 'meet',
        label: meet.label || 'Meet-up',
      });
    }

    /* Everyone who needs help, then the three nearest of everybody else. The
       cap is what buys room for the standing cards below: a rail that grows
       with the party pushes the nearest toilet off the end exactly when a
       family big enough to lose someone is the family using it. Help is never
       capped — that card is the reason the rail exists. */
    const byRange = [...members].sort(
      (a, b) => distance(me.lat, me.lng, a.lat, a.lng) - distance(me.lat, me.lng, b.lat, b.lng),
    );
    const helping = byRange.filter((m) => m.status === 'NEED HELP');
    const resting = byRange.filter((m) => m.status !== 'NEED HELP').slice(0, 3);

    [...helping, ...resting]
      .forEach((m) => {
        const stale = Date.now() - m.ts > 300000;
        const help = m.status === 'NEED HELP';
        push(
          `m-${m.id}`,
          help ? 'Needs help' : m.status,
          m.name,
          m,
          help ? 'var(--crimson)' : m.colour,
          formatAge(Date.now() - m.ts),
          help ? 'help' : stale ? 'stale' : 'member',
          { kind: 'member', id: m.id, label: m.name },
        );
      });

    if (selected) {
      push('sel', 'Heading for', selected.n, selected, 'var(--beacon)', selected.a, 'selected', {
        kind: 'poi',
        label: selected.n,
        lat: selected.lat,
        lng: selected.lng,
      });
    }

    /* The nearest of the things people actually go looking for. These used to
       appear only on an otherwise empty rail, which put them behind the exact
       condition that hides them: join a party or tap a ride and the nearest
       toilet disappears. They stand at the end of the rail instead, always,
       and drop out only when they would repeat a card already on it.

       `first_aid` is matched on the name because no venue file carries a
       subtype — the builder folds first aid into `service` and the card had
       silently never rendered at any park. */
    const wants = [
      ['Nearest toilet', (p) => p.c === 'restroom', palette.categories.restroom],
      ['Nearest food', (p) => p.c === 'food', palette.categories.food],
      [
        'First aid',
        (p) => p.c === 'service' && /first ?aid|medic|nurse/i.test(p.n || ''),
        palette.categories.service,
      ],
    ];
    const already = new Set(out.map((c) => `${c.target.lat},${c.target.lng}`));
    wants.forEach(([eyebrow, pred, colour], i) => {
      const hit = nearestOf(pois, me.lat, me.lng, pred);
      if (!hit) return;
      const at = `${hit.poi.lat},${hit.poi.lng}`;
      if (already.has(at)) return;
      already.add(at);
      push(`n-${i}`, eyebrow, hit.poi.n, hit.poi, colour, hit.poi.a, 'nearby', {
        kind: 'poi',
        label: hit.poi.n,
        lat: hit.poi.lat,
        lng: hit.poi.lng,
      });
    });

    return out;
  }, [pois, me, members, meet, selected, heading, palette]);

  if (!me) {
    return (
      <div className="glanceEmpty">
        <span>Turn on location to see distance and direction to your group.</span>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="glanceEmpty">
        <button type="button" className="btn small" onClick={onOpenParty}>
          Start or join a party
        </button>
      </div>
    );
  }

  return (
    <div className="glanceRail" role="list">
      {cards.map((c) => {
        const walking = Boolean(navKey) && navKey === keyOfNav(c.nav);
        // While a route is running, the card stops quoting the crow-flies range
        // and quotes what is actually left of the walk — otherwise the card and
        // the banner above it disagree about the same destination.
        const onFoot = walking && Number.isFinite(navMetres);
        return (
          <div key={c.key} role="listitem" className={`glanceCard ${c.tone} ${walking ? 'walking' : ''}`}>
            <button type="button" className="glanceHit" onClick={() => onFocus(c.target)}>
              <span className="glanceEyebrow" style={{ color: c.colour }}>
                {c.eyebrow}
              </span>
              {/* Time and range on one line rather than stacked. Stacked, they
                  cost the rail sixteen pixels of height — and the rail's height
                  is the collapsed sheet's height, which is map. */}
              <span className="glanceMain">
                <Arrow deg={c.deg} colour={c.colour} />
                <span className="glanceWalk">
                  <b>{onFoot ? formatWalk(navMetres) : c.walk}</b>
                  <em>{onFoot ? formatDistance(navMetres) : c.dist}</em>
                </span>
              </span>
              <span className="glanceTitle">{c.title}</span>
              {/* The compass point used to lead this line. The arrow above is
                  the same answer and a better one — it is aimed relative to the
                  way you are facing, where "NE" leaves you to work that out — so
                  the line is down to the thing the arrow cannot say. */}
              <span className="glanceFoot">{c.footnote}</span>
            </button>
            {onNavigate && c.nav && (
              <button
                type="button"
                className={`glanceGo ${walking ? 'on' : ''}`}
                onClick={() => onNavigate(walking ? null : c.nav)}
                aria-label={walking ? `Stop walking to ${c.title}` : `Walk me to ${c.title}`}
              >
                {walking ? 'Stop' : 'Go'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
