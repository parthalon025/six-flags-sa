'use client';

import { useEffect, useState } from 'react';
import BrandMark from '@/components/BrandMark';
import { loadScenario, saveScenario, createScenario, addStep, clearScenario, visibleSteps, mergeScenario } from '@/lib/scenario';
import { recent } from '@/lib/actionLog';

const GROUPS = ['', 'A', 'B', 'C'];

/** Turn raw action-log kinds into Parkbound adventure moments. */
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
  onApplyPlan,
  onUndoMeet,
  myGroupId,
  onGroupId,
  sharingPaused,
  onSharingPaused,
}) {
  const [scenario, setScenario] = useState(null);
  const [log, setLog] = useState([]);

  useEffect(() => {
    setScenario(loadScenario() || createScenario('Today'));
  }, []);

  useEffect(() => {
    recent(8).then(setLog).catch(() => setLog([]));
  }, [rides, scenario]);

  if (!scenario) return null;

  const steps = visibleSteps(scenario, rides);

  return (
    <div className="intelPanel">
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

      <div className="label">You Are Here</div>
      <button
        type="button"
        className={`btn ${sharingPaused ? 'danger' : ''}`}
        onClick={() => onSharingPaused?.(!sharingPaused)}
      >
        {sharingPaused ? 'Paused — tap to share again' : 'Pause sharing where I am'}
      </button>

      <div className="label">Plan (this phone only)</div>
      {steps.length === 0 ? (
        <p className="fine">No steps yet. Save a place from Explore to build your trail.</p>
      ) : (
        <ul className="planList">
          {steps.map((s) => (
            <li key={s.id} className={s.down ? 'struck' : ''}>
              {s.label || s.placeId}
              {s.down ? ` — ${s.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="joinRow">
        <button
          type="button"
          className="btn small primary"
          disabled={!steps.some((s) => !s.down)}
          onClick={() => onApplyPlan?.(mergeScenario(scenario, rides))}
        >
          Apply plan to party
        </button>
        <button type="button" className="btn small" onClick={() => { clearScenario(); setScenario(createScenario('Today')); }}>
          Clear plan
        </button>
      </div>

      {log.length > 0 && (
        <>
          <div className="label">Today</div>
          {/* Trail language for the day summary — glyph + dotted path (brand sheet Image 3). */}
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
          <button type="button" className="btn small" onClick={() => onUndoMeet?.()}>
            Undo last meet-up
          </button>
        </>
      )}
    </div>
  );
}

export function addPlaceToPlan(place) {
  let sc = loadScenario();
  if (!sc) sc = createScenario('Today');
  const next = addStep(sc, {
    kind: 'target',
    placeId: place.i || place.id,
    label: place.n,
  });
  saveScenario(next);
  return next;
}
