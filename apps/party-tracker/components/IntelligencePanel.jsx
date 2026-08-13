'use client';

import { useEffect, useState } from 'react';
import BrandMark from '@/components/BrandMark';
import { recent } from '@/lib/actionLog';
import { reorder, unstar, withDown } from '@/lib/plan';

const GROUPS = ['', 'A', 'B', 'C'];

/** Turn raw action-log kinds into Park Bound day moments. */
function momentLabel(entry) {
  const place = entry.detail?.label || entry.detail?.name || '';
  switch (entry.kind) {
    case 'meet':
    case 'meetup':
    case 'meet_set':
      return place ? `Meet-up · ${place}` : 'Meet-up set';
    case 'nav':
    case 'navigate':
    case 'route':
      return place ? `Trail to ${place}` : 'Hit the trail';
    case 'plan':
    case 'save':
    case 'favorite':
      return place ? `Saved · ${place}` : 'Saved a stop';
    case 'party':
    case 'join':
      return 'Joined the party';
    case 'ride':
    case 'report':
      return place ? `Checked · ${place}` : 'Checked a ride';
    default:
      return place ? `${entry.kind} — ${place}` : entry.kind;
  }
}

export default function IntelligencePanel({
  rides = {},
  plan = [],
  inParty = false,
  onSetPlan,
  onWalkStop,
  onUndoMeet,
  myGroupId,
  onGroupId,
}) {
  const [log, setLog] = useState([]);

  useEffect(() => {
    recent(8).then(setLog).catch(() => setLog([]));
  }, [rides, plan]);

  const steps = withDown(plan, rides);

  function move(i, dir) {
    onSetPlan?.(reorder(plan, i, dir));
  }

  return (
    <div className="intelPanel">
      {inParty && (
        <>
          <div className="label">My party</div>
          <div className="chips wrap">
            {GROUPS.map((g) => (
              <button
                key={g || 'none'}
                type="button"
                className={`chip ${(myGroupId || '') === g ? 'on' : ''}`}
                onClick={() => onGroupId?.(g || null)}
              >
                {g || 'None'}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="label">Plan</div>
      {steps.length === 0 ? (
        <p className="fine">No stops yet. Star a place from Explore to build today&apos;s Plan.</p>
      ) : (
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
                <button type="button" className="btn small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  ↑
                </button>
                <button type="button" className="btn small" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
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
      )}
      {steps.length > 0 && (
        <div className="joinRow">
          <button
            type="button"
            className="btn small"
            onClick={() => onSetPlan?.([])}
          >
            Clear plan
          </button>
        </div>
      )}

      {log.length > 0 && (
        <>
          <div className="label">Today</div>
          <div className="dayTrail" aria-hidden="true">
            <svg className="dayTrailPath" viewBox="0 0 120 24" preserveAspectRatio="none">
              <path
                d="M4 18 C28 4, 52 20, 76 10 S108 6, 116 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeDasharray="0 8"
              />
            </svg>
            <BrandMark variant="glyph" size={22} aqua="var(--aqua)" className="dayTrailMark" />
          </div>
          <ul className="planList">
            {log.map((e) => (
              <li key={e.id}>
                {momentLabel(e)}
              </li>
            ))}
          </ul>
          {inParty && (
            <button type="button" className="btn small" onClick={() => onUndoMeet?.()}>
              Undo last meet-up
            </button>
          )}
        </>
      )}
    </div>
  );
}
