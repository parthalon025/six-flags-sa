'use client';

import { useMemo, useRef } from 'react';
import Icon from '@/components/Icon';
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
  // Called when the visitor gets rid of a card: {kind:'selected'} for the
  // place they tapped, {kind:'category', category} for a standing one.
  onDismiss = null,
  // Kinds of standing card this visitor has got rid of.
  hidden = null,
  // The rail with the sheet pulled almost shut: one line instead of a row of
  // cards. See lib/sheet.js — the height the visitor has left the sheet at buys
  // a card or it buys a line, and a line is a great deal better than nothing.
  compact = false,
}) {
  const palette = paletteFor(theme);
  // The places are the loaded venue's, so they have to be a dependency of the
  // memo below: without it, switching venues leaves the rail pointing at the
  // restrooms of a park a thousand miles away.
  const pois = usePois();

  /* Swipe a card up to get rid of it.
     Up rather than sideways: sideways is how the rail scrolls, and a gesture
     that fights the scroll fires when nobody meant it. The start of the press
     is held in a ref rather than a closure because this rail re-renders on
     every position tick — a closure would be replaced mid-gesture, and the
     release would find nothing to compare against. */
  const press = useRef(null);
  const swipeAway = (onShed) => ({
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      press.current = { x: e.clientX, y: e.clientY, onShed, held: false };
    },
    onPointerMove: (e) => {
      const from = press.current;
      if (!from || from.held) return;
      if (from.y - e.clientY < 10) return;
      /* Captured once the press has become a drag, and not before. A swipe up
         ends with the finger above the card, so without the capture the release
         lands on the map and the card never hears the end of its own gesture —
         but capturing on the press instead would redirect the click too, and
         the ✕ inside the card would stop working. */
      from.held = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerUp: (e) => {
      const from = press.current;
      press.current = null;
      if (from?.held) e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (!from) return;
      const dx = Math.abs(e.clientX - from.x);
      const dy = from.y - e.clientY;
      if (dy > 48 && dx < 40) from.onShed();
    },
    onPointerCancel: () => {
      press.current = null;
    },
  });

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
      out[out.length - 1].shed = { kind: 'selected' };
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
      ['restroom', 'Nearest toilet', (p) => p.c === 'restroom', palette.categories.restroom],
      ['food', 'Nearest food', (p) => p.c === 'food', palette.categories.food],
      [
        'firstaid',
        'First aid',
        (p) => p.c === 'service' && /first ?aid|medic|nurse/i.test(p.n || ''),
        palette.categories.service,
      ],
    ];
    const already = new Set(out.map((c) => `${c.target.lat},${c.target.lng}`));
    wants.forEach(([key, eyebrow, pred, colour], i) => {
      if (hidden?.includes(key)) return;
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
      /* Keyed on the kind of place, not on the place. The toilet behind
         "nearest toilet" changes as she walks, so a dismissal remembered
         against the POI would be undone by the next one thirty seconds
         later — which reads as the app ignoring her. */
      out[out.length - 1].shed = { kind: 'category', category: key };
    });

    return out;
  }, [pois, me, members, meet, selected, heading, palette, hidden]);

  /* One line, for a sheet with room for one line.
     Whoever needs help leads it whatever their range, and otherwise it is the
     nearest thing on the rail — the same order the cards are already in. The
     rest of them are a count rather than a list, because the point of this
     strip is that it is one line: it says how many answers are under the
     handle without pretending to be them. */
  if (compact) {
    const lead = cards.find((c) => c.tone === 'help') || cards[0];
    if (!lead) {
      return (
        <div className="glanceDigest quiet">
          <span>
            {me ? 'Start or join a party' : 'Turn on location for distance and direction'}
          </span>
        </div>
      );
    }
    return (
      <button
        type="button"
        className={`glanceDigest ${lead.tone}`}
        onClick={() => onFocus(lead.target)}
      >
        <Arrow deg={lead.deg} colour={lead.colour} />
        <b>{lead.walk}</b>
        <span className="glanceDigestName">{lead.title}</span>
        <em style={{ color: lead.colour }}>{lead.eyebrow}</em>
        {cards.length > 1 && <span className="glanceDigestMore">+{cards.length - 1}</span>}
      </button>
    );
  }

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
        const shed = onDismiss && c.shed ? () => onDismiss(c.shed) : null;
        return (
          <div
            key={c.key}
            role="listitem"
            className={`glanceCard ${c.tone} ${walking ? 'walking' : ''}`}
            {...(shed ? swipeAway(shed) : null)}
          >
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
            {shed && (
              /* Both, on purpose. The swipe is what a thumb already knows and
                 it costs the card no room; the × is what makes it findable by
                 somebody who has never swiped a card away in their life. */
              <button
                type="button"
                className="glanceShed"
                onClick={shed}
                aria-label={`Remove ${c.title} from this list`}
              >
                <Icon name="xmark.circle.fill" size={17} />
              </button>
            )}
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
