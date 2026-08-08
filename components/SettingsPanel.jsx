'use client';

import InstallCard from '@/components/InstallCard';

/* Settings, arranged the way Settings is: short groups of rows, a value on the
   right of the row that has one, and a chevron on the rows that lead somewhere.
   The long tail — which categories draw, which map, what the transport is
   doing — lives behind those chevrons rather than in one column you scroll. */

export default function SettingsPanel({
  identity,
  onName,
  onNameCommit,
  position,
  onLocationSettings,
  theme,
  onTheme,
  categoryCount,
  categoryTotal,
  venueName,
  onPush,
  pushKinds = null,
  pushPrefs = null,
  onPushPref = null,
  pushState = 'idle',
  onEnablePush = null,
  pushNeedsInstall = false,
}) {
  return (
    <div>
      <div className="label">Your Name in the Roster</div>
      <input
        className="field"
        maxLength={14}
        value={identity?.name === 'Guest' ? '' : identity?.name || ''}
        placeholder="Name"
        onChange={(e) => onName(e.target.value)}
        onBlur={(e) => onNameCommit(e.target.value)}
      />
      <p className="fine">This is what your party sees on the map and in the roster.</p>

      <div className="label">Map Appearance</div>
      <div className="segmented" role="group" aria-label="Map appearance">
        {[
          ['day', 'Light'],
          ['night', 'Dark'],
        ].map(([key, labelText]) => (
          <button
            key={key}
            type="button"
            className={`tab ${theme === key ? 'on' : ''}`}
            aria-pressed={theme === key}
            onClick={() => onTheme(key)}
          >
            {labelText}
          </button>
        ))}
      </div>
      <p className="fine">
        Light is the one to use outdoors — white midways on pale ground, dark type, and
        deeper marker colours that survive direct sun. Dark is easier on the eyes once the
        park lights come on.
      </p>

      <div className="label">The Map</div>
      <div className="rowList">
        <button type="button" className="row" onClick={() => onPush('venues')}>
          <span className="rowText">Which map</span>
          <span className="rowValue">{venueName || '—'}</span>
        </button>
        <button type="button" className="row" onClick={() => onPush('categories')}>
          <span className="rowText">Show on the map</span>
          <span className="rowValue">
            {categoryCount} of {categoryTotal}
          </span>
        </button>
      </div>

      {pushKinds && (
        <>
          <div className="label">Tell Me On This Phone</div>
          {pushState === 'granted' ? (
            <div className="rowList">
              {Object.entries(pushKinds).map(([key, spec]) => (
                <button
                  key={key}
                  type="button"
                  className="row"
                  onClick={() => onPushPref?.(key, !pushPrefs?.[key])}
                  aria-pressed={Boolean(pushPrefs?.[key])}
                >
                  <span className="rowText">{spec.label}</span>
                  <span className="rowValue">{pushPrefs?.[key] ? 'On' : 'Off'}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                onClick={onEnablePush}
                disabled={pushNeedsInstall || pushState === 'unsupported'}
              >
                Turn on notifications
              </button>
              <p className="fine">
                {pushNeedsInstall
                  ? 'On an iPhone this works once the app is on your Home Screen — see “Install on this phone” below.'
                  : pushState === 'denied'
                    ? 'Your phone is blocking them for this site. Turn them back on in its settings, then come back here.'
                    : 'Without these, a phone in a pocket shows nothing when somebody in your party needs you.'}
              </p>
            </>
          )}
          {pushState === 'granted' && (
            <p className="fine">
              {pushKinds.quiet.hint}
            </p>
          )}
        </>
      )}

      <div className="label">Location</div>
      <div className="rowList">
        <button type="button" className="row" onClick={onLocationSettings}>
          <span className="rowText">Location settings</span>
          <span className="rowValue">
            {position ? (position.manual ? 'Placed by hand' : 'Phone GPS') : 'No fix yet'}
          </span>
        </button>
      </div>
      {position && (
        <p className="fine">
          {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
        </p>
      )}

      <div className="label">Install on This Phone</div>
      <InstallCard />

      <div className="label">Advanced</div>
      <div className="rowList">
        <button type="button" className="row" onClick={() => onPush('diagnostics')}>
          <span className="rowText">Diagnostics</span>
        </button>
      </div>
    </div>
  );
}
