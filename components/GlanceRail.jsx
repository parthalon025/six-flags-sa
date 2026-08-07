'use client';

import { useMemo } from 'react';
import { bearing, cardinal, distance, formatAge, formatDistance, formatWalk } from '@/lib/geo';
import { POIS } from '@/lib/park';
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

function nearestOf(lat, lng, predicate) {
  let best = null;
  POIS.forEach((p) => {
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
  onOpenParty,
}) {
  const palette = paletteFor(theme);

  const cards = useMemo(() => {
    if (!me) return [];
    const out = [];
    const rel = (b) => (heading == null ? b : (b - heading + 360) % 360);

    const push = (key, eyebrow, title, target, colour, footnote, tone) => {
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
      });
    };

    if (meet) {
      push('meet', 'Meet-up', meet.label, meet, 'var(--crimson)', `set by ${meet.by}`, 'meet');
    }

    [...members]
      .sort((a, b) => distance(me.lat, me.lng, a.lat, a.lng) - distance(me.lat, me.lng, b.lat, b.lng))
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
        );
      });

    if (selected) {
      push('sel', 'Heading for', selected.n, selected, 'var(--beacon)', selected.a, 'selected');
    }

    // With nothing else to track, the useful answer is the nearest of the
    // things people actually go looking for.
    if (out.length === 0) {
      const wants = [
        ['Nearest restroom', (p) => p.c === 'restroom', palette.categories.restroom],
        ['Nearest food', (p) => p.c === 'food', palette.categories.food],
        ['First aid', (p) => p.s === 'first_aid', palette.categories.service],
      ];
      wants.forEach(([eyebrow, pred, colour], i) => {
        const hit = nearestOf(me.lat, me.lng, pred);
        if (hit) push(`n-${i}`, eyebrow, hit.poi.n, hit.poi, colour, hit.poi.a, 'nearby');
      });
    }

    return out;
  }, [me, members, meet, selected, heading, palette]);

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
      {cards.map((c) => (
        <button
          type="button"
          key={c.key}
          role="listitem"
          className={`glanceCard ${c.tone}`}
          onClick={() => onFocus(c.target)}
        >
          <span className="glanceEyebrow" style={{ color: c.colour }}>
            {c.eyebrow}
          </span>
          <span className="glanceMain">
            <Arrow deg={c.deg} colour={c.colour} />
            <span className="glanceWalk">
              <b>{c.walk}</b>
              <em>{c.dist}</em>
            </span>
          </span>
          <span className="glanceTitle">{c.title}</span>
          <span className="glanceFoot">
            {c.card} · {c.footnote}
          </span>
        </button>
      ))}
    </div>
  );
}
