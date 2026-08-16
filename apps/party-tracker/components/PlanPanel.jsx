'use client';

import { useState } from 'react';
import HeightPanel from '@/components/HeightPanel';
import PlanStops from '@/components/PlanStops';

/**
 * Plan tab — today's ordered stops plus optional rider-height tools when the
 * venue publishes height rules.
 */
export default function PlanPanel({
  rides = {},
  plan = [],
  onSetPlan,
  onWalkStop,
  hasHeights = false,
  height,
  withAdult,
  onHeight,
  onWithAdult,
  venue,
}) {
  const [section, setSection] = useState('stops');
  const stopCount = plan.length;

  return (
    <div className="planPanel">
      {hasHeights ? (
        <div className="settingsTopics" role="tablist" aria-label="Plan sections">
          <button
            type="button"
            role="tab"
            className={`settingsTopic ${section === 'stops' ? 'on' : ''}`}
            aria-selected={section === 'stops'}
            onClick={() => setSection('stops')}
          >
            Stops{stopCount ? ` (${stopCount})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            className={`settingsTopic ${section === 'heights' ? 'on' : ''}`}
            aria-selected={section === 'heights'}
            onClick={() => setSection('heights')}
          >
            Heights
          </button>
        </div>
      ) : null}

      {(!hasHeights || section === 'stops') && (
        <>
          <div className="label">Today&apos;s stops</div>
          <PlanStops
            rides={rides}
            plan={plan}
            onSetPlan={onSetPlan}
            onWalkStop={onWalkStop}
          />
        </>
      )}

      {hasHeights && section === 'heights' && (
        <HeightPanel
          height={height}
          withAdult={withAdult}
          onHeight={onHeight}
          onWithAdult={onWithAdult}
          venue={venue}
        />
      )}
    </div>
  );
}
