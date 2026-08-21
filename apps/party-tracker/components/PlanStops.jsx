'use client';

import { reorder, unstar, withDown } from '@/lib/plan';

/* Ordered Plan stops — shared by the Plan tab and the Party intelligence panel.

   A stop is a card rather than a bullet: the ordinal, the name, and one
   sub-line saying which Zone it is in and how far the walk is. That sub-line is
   handed in via `context` rather than read off the step, because a Plan item's
   wire shape is `{id, placeId, label}` and nothing else — the list rides inside
   every Party snapshot, so widening it would put a Zone name and a walk time on
   the wire for every Member, all day, to say something the receiving phone can
   work out for itself from the venue file and its own fix. */

/**
 * @param {object} props
 * @param {object} [props.context] `{ [placeId]: { zone, walk } }` — the caller
 *   works these out from its own venue and fix. A missing entry renders a card
 *   with no sub-line rather than an em dash.
 */
export default function PlanStops({
  rides = {},
  plan = [],
  onSetPlan,
  onWalkStop,
  context = null,
  emptyHint = "No stops yet. Star a Place from Explore to build today's Plan.",
}) {
  const steps = withDown(plan, rides);

  function move(i, dir) {
    onSetPlan?.(reorder(plan, i, dir));
  }

  if (steps.length === 0) {
    return <p className="fine">{emptyHint}</p>;
  }

  return (
    <>
      <ol className="planStops">
        {steps.map((s, i) => {
          const where = context?.[s.placeId] || null;
          /* A down ride keeps its stop and its place in the order, so the
             sub-line carries the reason it is struck through and the two can
             never disagree. The reporter's own note wins over the generic
             phrase when there is one. */
          const sub = s.down
            ? [s.reason, where?.zone].filter(Boolean).join(' · ')
            : [where?.zone, where?.walk].filter(Boolean).join(' · ');
          const name = s.label || s.placeId;
          return (
            <li key={s.id || `${s.placeId}-${i}`} className="planStop">
              {/* The order and the controls that change it are one column: the
                  number says where the stop sits, the chevrons above and below
                  say which way it can move. A single stop has nowhere to go, so
                  it is just the number. */}
              <span className="planOrder">
                {steps.length > 1 && (
                  <button
                    type="button"
                    className="planNudge"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={`Move ${name} up`}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M5 15.5 12 8.5l7 7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
                <span className="planPip">{i + 1}</span>
                {steps.length > 1 && (
                  <button
                    type="button"
                    className="planNudge"
                    disabled={i === steps.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`Move ${name} down`}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M5 8.5 12 15.5l7-7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </span>

              <span className="planStopText">
                <b className={s.down ? 'struck' : ''}>{name}</b>
                {sub ? <span>{sub}</span> : null}
              </span>

              <button type="button" className="planWalk" onClick={() => onWalkStop?.(s)}>
                Walk
              </button>
              <button
                type="button"
                className="planDrop"
                onClick={() => onSetPlan?.(unstar(plan, s.placeId))}
                aria-label={`Remove ${name} from Plan`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6 6 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </li>
          );
        })}
      </ol>
      {/* The design never drew this, so it takes the shape it gives every other
          quiet correction on these screens — the outlined pill Collection uses
          for "Offer to Party". A full-width button here sat between the stops
          and the note about them with more weight than either. */}
      <div className="planClearRow">
        <button type="button" className="pillGhost" onClick={() => onSetPlan?.([])}>
          Clear plan
        </button>
      </div>
    </>
  );
}
