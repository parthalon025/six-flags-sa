'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import Icon from '@/components/Icon';
import { LIVE, WORDS } from '@/lib/brand';
import { bearing, cardinal, distance, formatAge, formatDistance, formatWalk } from '@/lib/geo';
import { recommendNow } from '@/lib/live';
import { navKeyOf as keyOfNav } from '@/lib/navKey';
import { usePois } from '@/lib/venue/useVenue';
import { paletteFor } from '@/lib/theme';
import { placeNav } from '@/lib/venue/ids';

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

function GlanceRail({
  me,
  members,
  meet,
  car,
  selected,
  heading,
  theme,
  onFocus,
  onNavigate,
  navKey,
  navMetres,
  onOpenParty,
  // Live recommendations. Optional — without them the rail is proximity-only.
  weather = null,
  rides = null,
  now = Date.now(),
  // Eligibility from fromFacts(facts, places). Optional: without it the GO NOW cards
  // just drop the eligibility line from their Why?.
  eligibility = null,
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
  /* The rail is a scroll-snap container, and a snap container that gains a card
     at the front keeps the card it was snapped to — so the new one lands off
     the left edge, unseen. Which is exactly backwards: a card appears at the
     head of this rail because something just happened that the visitor should
     look at. Saving where the car is, somebody setting the meet-up, somebody
     needing help. So when the leading card changes, the rail goes back to the
     start; scroll it yourself afterwards and it stays where you put it. */
  const railRef = useRef(null);
  const lead = useRef(null);

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

    const push = (key, eyebrow, title, target, colour, footnote, tone, nav, why = null) => {
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
        // The fuller "Why?" — every factor behind the pick, joined into one
        // line. Only GO NOW cards carry one; it rides as a native tooltip
        // rather than more visible UI, so the rail stays a rail and not a
        // dashboard of reasons nobody asked to see.
        why,
      });
    };

    if (meet) {
      push('meet', LIVE.meetup, meet.label, meet, 'var(--adventure)', `set by ${meet.by}`, 'meet', {
        kind: 'meet',
        label: meet.label || 'Rally Point',
      });
    }

    /* The car, next to the Rally Point because they are the same kind of thing: a
       spot somebody put there rather than a place the park has. It ranks above
       the party on purpose — the roster is what you look at all day, and this
       is what you look at once, at the end, when it is dark and every row of a
       car park looks like every other row. */
    if (car) {
      push('car', 'Where I parked', 'Your car', car, 'var(--indigo)', formatAge(Date.now() - car.at), 'car', {
        kind: 'car',
        label: 'Where I parked',
      });
      // The ✕ on this card forgets the spot rather than hiding the card, which
      // is what the ✕ means everywhere else on the rail. Nothing else would be
      // honest: a card that pointed at a car you had driven home is worse than
      // no card, and there is no other place to say so.
      out[out.length - 1].shed = { kind: 'car' };
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
      push('sel', 'Next Stop', selected.n, selected, 'var(--beacon)', selected.a, 'selected', {
        ...placeNav(selected),
      });
      out[out.length - 1].shed = { kind: 'selected' };
    }

    /* What should I do right now? Up to two GO NOW rides, before standing
       amenity cards — recommendations beat the nearest toilet when the sky
       and the party say a ride is worth walking to. */
    if (!hidden?.includes('gonow')) {
      const picks = recommendNow(pois, rides, weather, me, members, now, 2, { eligibility });
      picks.forEach(({ poi, live, metres, why, factors }, i) => {
        const at = `${poi.lat},${poi.lng}`;
        if (out.some((c) => c.target && `${c.target.lat},${c.target.lng}` === at)) return;
        // Always stamp a Why? title on GO NOW cards — factors[] when present,
        // else the one-line why / live detail — so long-press and the vertical
        // check both have something to read even before weather/party reports.
        const tip = `Why: ${
          factors?.length
            ? factors.map((f) => f.label).join(' \u00b7 ')
            : why || live.detail || 'Nearby pick'
        }`;
        push(
          `go-${poi.id || i}`,
          LIVE.goNow,
          poi.n,
          poi,
          'var(--adventure)',
          why || live.detail || poi.a || formatWalk(metres),
          'goNow',
          placeNav(poi),
          tip,
        );
        out[out.length - 1].shed = { kind: 'category', category: 'gonow' };
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
      ['restroom', 'Nearest restroom', (p) => p.c === 'restroom', palette.categories.restroom],
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
      push(`n-${i}`, eyebrow, hit.poi.n, hit.poi, colour, hit.poi.a, 'nearby', placeNav(hit.poi));
      /* Keyed on the kind of place, not on the place. The toilet behind
         "nearest toilet" changes as she walks, so a dismissal remembered
         against the POI would be undone by the next one thirty seconds
         later — which reads as the app ignoring her. */
      out[out.length - 1].shed = { kind: 'category', category: key };
    });

    return out;
  }, [
    pois,
    me,
    members,
    meet,
    car,
    selected,
    heading,
    palette,
    hidden,
    weather,
    rides,
    now,
    eligibility,
  ]);

  const leadKey = cards[0]?.key ?? null;
  useEffect(() => {
    if (lead.current === leadKey) return;
    const was = lead.current;
    lead.current = leadKey;
    // Not on first render: the rail arriving is not the same as a card
    // arriving, and there is nothing to scroll back from.
    if (was === null || !railRef.current || !railRef.current.scrollLeft) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    railRef.current.scrollTo({ left: 0, behavior: still ? 'auto' : 'smooth' });
  }, [leadKey]);

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
            {me
              ? 'Pull up for restrooms, food, and rides'
              : 'Turn on location for nearby restrooms and food'}
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
        <span>Turn on location to see the nearest restroom, food, and how far to walk.</span>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="glanceEmpty">
        <span>Search above for a restroom, food, or a ride — or pull the sheet up to browse.</span>
        {onOpenParty ? (
          <button type="button" className="btn small" onClick={onOpenParty}>
            Party with family
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="glanceRail" role="list" ref={railRef}>
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
            <button
              type="button"
              className="glanceHit"
              onClick={() => onFocus(c.target)}
              title={c.why || undefined}
            >
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
            {(shed || (onNavigate && c.nav)) && (
              <div className="glanceActions">
                {onNavigate && c.nav && (
                  <button
                    type="button"
                    className={`glanceGo ${walking ? 'on' : ''}`}
                    onClick={() => onNavigate(walking ? null : c.nav)}
                    aria-label={walking ? `Stop walking to ${c.title}` : `${WORDS.navigation} — ${c.title}`}
                  >
                    <Icon name={walking ? 'xmark' : 'location.fill'} size={walking ? 14 : 15} />
                  </button>
                )}
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default memo(GlanceRail);
