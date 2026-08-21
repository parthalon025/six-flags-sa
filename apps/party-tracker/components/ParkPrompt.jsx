'use client';

/*
 * Explore-without-GPS: the same World pick the intake shows, reached by hand
 * instead of by a fix. The screen itself lives in WorldPicker — this is the
 * card it stands in, and the `explore` flag is what tells the picker there is
 * no location to reason from, so it asks which World rather than whether this
 * one.
 */

import WorldPicker from '@/components/WorldPicker';

export default function ParkPrompt({
  choice,
  options = [],
  busy = false,
  error = null,
  explore = false,
  onConfirm,
  onSkip,
}) {
  if (!choice?.venue) return null;

  return (
    <div className="gate">
      <div className="gateCard">
        <div className="gateEyebrow">Explore Worlds</div>
        <WorldPicker
          choice={choice}
          options={options}
          busy={busy}
          error={error}
          explore={explore}
          onConfirm={onConfirm}
          onSkip={onSkip}
        />
      </div>
    </div>
  );
}
