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
  shareMode: shareModeProp = null,
  shareUntil = null,
  onShareMode = null,
}) {
  const [scenario, setScenario] = useState(null);
  const [log, setLog] = useState([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setScenario(loadScenario() || createScenario('Today'));
  }, []);

  useEffect(() => {
    recent(8).then(setLog).catch(() => setLog([]));
  }, [rides, scenario]);

  useEffect(() => {
    if (!shareUntil) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [shareUntil]);

  if (!scenario) return null;

  const steps = visibleSteps(scenario, rides);
  const shareMode = shareModeProp || (sharingPaused ? 'off' : 'approx');
  const shareUntilLabel =
    shareMode === 'precise' && shareUntil && shareUntil > now
      ? `${Math.max(1, Math.ceil((shareUntil - now) / 60000))} min left`
      : null;

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

      <div className="label">Where others see you</div>
      <div className="segmented" role="group" aria-label="Location sharing">
        {[
          ['off', 'Off'],
          ['approx', 'Approx'],
          ['precise', 'Precise'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={`tab ${shareMode === mode ? 'on' : ''}`}
            aria-pressed={shareMode === mode}
            onClick={() => onShareMode?.(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="fine">
        {shareMode === 'off'
          ? 'Your pin is hidden. The map still works for you.'
          : shareMode === 'precise'
            ? shareUntilLabel
              ? `Exact GPS for ${shareUntilLabel}, then back to approx — less creepy by default.`
              : 'Exact GPS — renews for 30 minutes at a time.'
            : 'Nearby enough to find each other (~50 m). Default while you walk.'}
      </p>
      <button
        type="button"
        className={`btn ${shareMode === 'off' ? 'danger' : ''}`}
        onClick={() => onSharingPaused?.(shareMode !== 'off')}
      >
        {shareMode === 'off' ? 'Paused — tap for approx sharing' : 'Pause sharing where I am'}
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
