'use client';

import { useEffect, useState } from 'react';
import BrandMark from '@/components/BrandMark';
import PlanStops from '@/components/PlanStops';
import { recent } from '@/lib/actionLog';

const GROUPS = ['', 'A', 'B', 'C'];

/** Turn raw action-log kinds into Park Bound day moments. */
function momentLabel(entry) {
  const place = entry.detail?.label || entry.detail?.name || '';
  switch (entry.kind) {
    case 'meet':
    case 'meetup':
    case 'meet_set':
      return place ? `Rally · ${place}` : 'Rally Point set';
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
  planContext = null,
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
      <PlanStops
        rides={rides}
        plan={plan}
        context={planContext}
        onSetPlan={onSetPlan}
        onWalkStop={onWalkStop}
      />

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
              Undo last Rally
            </button>
          )}
        </>
      )}
    </div>
  );
}
