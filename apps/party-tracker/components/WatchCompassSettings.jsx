'use client';

import { useEffect, useMemo, useState } from 'react';
import WatchCompassFace from '@/components/WatchCompassFace';
import {
  DEFAULT_WATCH_SETTINGS,
  buildCompassMarks,
  loadWatchSettings,
  saveWatchSettings,
  watchAlwaysOnPayload,
} from '@/lib/compass';

/**
 * Full Watch Compass control panel (ADR-0011) — density, Always On, party/Meet,
 * units, turn haptics, raise-to-nav. Prefs sync to localStorage for the Watch
 * companion app (App Group key mirrored in native code).
 */
export default function WatchCompassSettings({
  me,
  members,
  meet,
  go,
  planNext,
  selected,
  heading,
  progress,
  walking,
}) {
  const [settings, setSettings] = useState(() => loadWatchSettings());
  const [previewAlwaysOn, setPreviewAlwaysOn] = useState(false);

  useEffect(() => {
    saveWatchSettings(settings);
  }, [settings]);

  const nextTurn = useMemo(() => {
    if (!walking || !progress?.step) return null;
    const step = progress.step;
    const label =
      typeof step.instruction === 'string'
        ? step.instruction
        : typeof step.text === 'string'
          ? step.text
          : Number.isFinite(step.distance)
            ? `${Math.round(step.distance)} m`
            : null;
    if (!label) return null;
    return { label: label.slice(0, 28) };
  }, [walking, progress]);

  const primaryDistanceM = useMemo(() => {
    const built = buildCompassMarks({
      me,
      heading,
      members,
      meet,
      go,
      selection: selected,
      planNext,
      showParty: settings.showParty,
      showMeet: settings.showMeet,
      includeNorth: false,
    });
    return built.primary?.distanceM ?? null;
  }, [me, heading, members, meet, go, selected, planNext, settings.showParty, settings.showMeet]);

  const alwaysOnPreview = previewAlwaysOn
    ? watchAlwaysOnPayload(settings, { primaryDistanceM, nextTurn })
    : null;

  function patch(partial) {
    setSettings((s) => ({ ...s, ...partial }));
  }

  return (
    <div className="watchCompassSettings">
      <p className="fine block">
        Apple Watch Compass uses the same facing-relative marks as the phone strip.
        Change how dense it looks and what appears — mark priority stays product-locked.
      </p>

      <div className="watchPreviewWrap">
        <WatchCompassFace
          me={me}
          heading={heading}
          members={members}
          meet={meet}
          go={go}
          selection={selected}
          planNext={planNext}
          showParty={settings.showParty}
          showMeet={settings.showMeet}
          density={settings.density}
          nextTurn={walking ? nextTurn : null}
          alwaysOnPreview={alwaysOnPreview}
        />
      </div>

      <div className="label">Density</div>
      <div className="segmented" role="group" aria-label="Compass density">
        {[
          ['glance', 'Glance'],
          ['split', 'Split'],
          ['detail', 'Detail'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`tab ${settings.density === key ? 'on' : ''}`}
            aria-pressed={settings.density === key}
            onClick={() => patch({ density: key })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="label">Always On</div>
      <div className="segmented" role="group" aria-label="Always On style">
        {[
          ['calm', 'Calm'],
          ['full', 'Full'],
          ['off', 'Off'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`tab ${settings.alwaysOn === key ? 'on' : ''}`}
            aria-pressed={settings.alwaysOn === key}
            onClick={() => patch({ alwaysOn: key })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="rowList">
        <button
          type="button"
          className="row"
          onClick={() => setPreviewAlwaysOn((v) => !v)}
        >
          <span className="rowText">Preview Always On</span>
          <span className="rowValue">{previewAlwaysOn ? 'On' : 'Off'}</span>
        </button>
      </div>

      <div className="label">What shows</div>
      <div className="rowList">
        <button
          type="button"
          className="row"
          onClick={() => patch({ showParty: !settings.showParty })}
        >
          <span className="rowText">Show party</span>
          <span className="rowValue">{settings.showParty ? 'On' : 'Off'}</span>
        </button>
        <button
          type="button"
          className="row"
          onClick={() => patch({ showMeet: !settings.showMeet })}
        >
          <span className="rowText">Show Meet</span>
          <span className="rowValue">{settings.showMeet ? 'On' : 'Off'}</span>
        </button>
      </div>

      <div className="label">Units</div>
      <div className="segmented" role="group" aria-label="Distance units">
        {[
          ['imperial', 'ft / mi'],
          ['metric', 'm / km'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`tab ${settings.units === key ? 'on' : ''}`}
            aria-pressed={settings.units === key}
            onClick={() => patch({ units: key })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="label">Navigation</div>
      <div className="rowList">
        <button
          type="button"
          className="row"
          onClick={() => patch({ turnHaptics: !settings.turnHaptics })}
        >
          <span className="rowText">Haptics on turn</span>
          <span className="rowValue">{settings.turnHaptics ? 'On' : 'Off'}</span>
        </button>
        <button
          type="button"
          className="row"
          onClick={() => patch({ raiseToNav: !settings.raiseToNav })}
        >
          <span className="rowText">Raise to show nav</span>
          <span className="rowValue">{settings.raiseToNav ? 'On' : 'Off'}</span>
        </button>
      </div>

      <button
        type="button"
        className="btn ghost"
        onClick={() => setSettings({ ...DEFAULT_WATCH_SETTINGS })}
      >
        Reset to shipping defaults
      </button>
      <p className="fine">
        Defaults: glance density, calm Always On. The Watch app reads the same
        preference key (parkbound-watch-compass-v1).
      </p>
    </div>
  );
}
