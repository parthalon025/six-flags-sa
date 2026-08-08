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
}) {
  return (
    <div>
      <div className="label">Your name in the roster</div>
      <input
        className="field"
        maxLength={14}
        value={identity?.name === 'Guest' ? '' : identity?.name || ''}
        placeholder="Name"
        onChange={(e) => onName(e.target.value)}
        onBlur={(e) => onNameCommit(e.target.value)}
      />
      <p className="fine">This is what your party sees on the map and in the roster.</p>

      <div className="label">Map appearance</div>
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

      <div className="label">The map</div>
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

      <div className="label">Install on this phone</div>
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
