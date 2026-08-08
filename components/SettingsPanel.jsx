'use client';

import { useEffect, useState } from 'react';
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
  hiddenCards = null,
  cardLabels = null,
  onUnhideCard = null,
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [armDiag, setArmDiag] = useState(false);
  useEffect(() => {
    if (!armDiag) return undefined;
    const t = setTimeout(() => setArmDiag(false), 5000);
    return () => clearTimeout(t);
  }, [armDiag]);

  return (
    <div>
      <div className="rowList">
        <button type="button" className="row" onClick={() => setHelpOpen((v) => !v)} aria-expanded={helpOpen}>
          <span className="rowText">What all this means</span>
          <span className="rowValue">{helpOpen ? 'Hide' : 'Read'}</span>
        </button>
      </div>
      {helpOpen && (
        <p className="fine block">
          A <b>party</b> is your group. One phone starts one and reads out the six-character code;
          everyone else types it in, scans the square, or opens the link. After that each phone
          shows the others as coloured dots, with how far away they are and how long it takes to
          walk there. A <b>meet-up</b> is one spot everybody agrees on, and anyone can set it. The
          phone that started the party <b>hosts</b> it, which only means it keeps the list — if it
          goes flat another phone picks the list up on its own, and nobody has to do anything.
          Nothing you do here is visible outside your party.
        </p>
      )}

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

      {onUnhideCard && (
        <>
          <div className="label">What the Panel Shows</div>
          <div className="rowList">
            {hiddenCards?.length ? (
              hiddenCards.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="row"
                  onClick={() => onUnhideCard(key)}
                >
                  <span className="rowText">{cardLabels?.[key] || key}</span>
                  <span className="rowValue">Hidden · tap to show</span>
                </button>
              ))
            ) : (
              /* Shown even with nothing in it. A row that only exists once you
                 have already hidden something is a row nobody knows is there,
                 which makes hiding something feel one-way. */
              <div className="row">
                <span className="rowText">Nothing hidden</span>
                <span className="rowValue">All cards showing</span>
              </div>
            )}
          </div>
          <p className="fine">
            Swipe a card up on the Explore panel, or tap its ✕, to get rid of it. Anything you
            remove is listed here for this park.
          </p>
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
        {/* "Frames sent / Version gaps / Electing" one tap from the top of a
            settings screen is somewhere to get lost. It takes a deliberate
            press to open now, and says so. */}
        <button
          type="button"
          className="row"
          onClick={() => (armDiag ? onPush('diagnostics') : setArmDiag(true))}
        >
          <span className="rowText">Diagnostics</span>
          <span className="rowValue">{armDiag ? 'Tap again to open' : 'For fault-finding'}</span>
        </button>
      </div>
    </div>
  );
}
