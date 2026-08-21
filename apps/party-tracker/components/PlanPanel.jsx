'use client';

import { useEffect, useState } from 'react';
import HeightPanel from '@/components/HeightPanel';
import PlanStops from '@/components/PlanStops';

/**
 * Plan tab — today's ordered stops plus optional rider-height tools when the
 * venue publishes height rules.
 */
export default function PlanPanel({
  rides = {},
  plan = [],
  planContext = null,
  onSetPlan,
  onWalkStop,
  hasHeights = false,
  height,
  withAdult,
  onHeight,
  onWithAdult,
  onMemberHeight = null,
  onMemberWithAdult = null,
  members = [],
  myId = null,
  inParty = false,
  openHeights = null,
  venue,
}) {
  const [section, setSection] = useState('stops');
  const stopCount = plan.length;

  /* A roster card's "Set a height" lands here, not on a screen of its own:
     `openHeights` carries the Member and a nonce, so tapping the same card
     twice still opens the section it asks for. Same shape as SettingsPanel's
     `openTopic`, for the same reason. */
  useEffect(() => {
    if (openHeights && hasHeights) setSection('heights');
  }, [openHeights, hasHeights]);

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
            context={planContext}
            onSetPlan={onSetPlan}
            onWalkStop={onWalkStop}
          />
          {/* "Shared with your Party" is only true once there is a Party. On one
              phone the same list is a draft that lives here and nowhere else,
              and saying otherwise would promise a sync that is not running. */}
          {stopCount > 0 ? (
            <p className="fine">
              {inParty
                ? 'The Plan is shared with your Party. Anyone can reorder it; Walk sets off from where you are.'
                : 'This Plan is on this phone. Start a Party and it becomes everyone’s — the stops come with you.'}
            </p>
          ) : null}
        </>
      )}

      {hasHeights && section === 'heights' && (
        <HeightPanel
          height={height}
          withAdult={withAdult}
          onHeight={onHeight}
          onWithAdult={onWithAdult}
          onMemberHeight={onMemberHeight}
          onMemberWithAdult={onMemberWithAdult}
          members={members}
          myId={myId}
          inParty={inParty}
          focus={openHeights}
          venue={venue}
        />
      )}
    </div>
  );
}
