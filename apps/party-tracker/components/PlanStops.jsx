'use client';

import { reorder, unstar, withDown } from '@/lib/plan';

/**
 * Ordered Plan stops — shared by the Plan tab and Party intelligence panel.
 */
export default function PlanStops({
  rides = {},
  plan = [],
  onSetPlan,
  onWalkStop,
  emptyHint = "No stops yet. Star a place from Explore to build today's Plan.",
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
      <ul className="planList">
        {steps.map((s, i) => (
          <li key={s.id || `${s.placeId}-${i}`} className={s.down ? 'struck' : ''}>
            <button
              type="button"
              className="linkish"
              onClick={() => onWalkStop?.(s)}
            >
              {s.label || s.placeId}
              {s.down ? ` — ${s.reason}` : ''}
            </button>
            <span className="planMove">
              <button
                type="button"
                className="btn small"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn small"
                disabled={i === steps.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => onSetPlan?.(unstar(plan, s.placeId))}
                aria-label="Remove from Plan"
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="joinRow">
        <button type="button" className="btn small" onClick={() => onSetPlan?.([])}>
          Clear plan
        </button>
      </div>
    </>
  );
}
