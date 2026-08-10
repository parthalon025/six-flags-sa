'use client';

import { useEffect, useState } from 'react';
import { loadScenario, saveScenario, createScenario, addStep, clearScenario, visibleSteps, mergeScenario } from '@/lib/scenario';
import { recent } from '@/lib/actionLog';

const GROUPS = ['', 'A', 'B', 'C'];

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
      <div className="label">My group</div>
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

      <div className="label">Location sharing</div>
      <button
        type="button"
        className={`btn ${sharingPaused ? 'danger' : ''}`}
        onClick={() => onSharingPaused?.(!sharingPaused)}
      >
        {sharingPaused ? 'Paused — tap to share again' : 'Pause sharing my location'}
      </button>

      <div className="label">Plan (this phone only)</div>
      {steps.length === 0 ? (
        <p className="fine">No steps yet. Add a place from Explore with &ldquo;Add to plan&rdquo;.</p>
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
          <div className="label">Recent (this phone)</div>
          <ul className="planList">
            {log.map((e) => (
              <li key={e.id}>
                {e.kind}
                {e.detail?.label ? ` — ${e.detail.label}` : ''}
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
