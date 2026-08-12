'use client';

import { useEffect, useState } from 'react';
import InstallCard from '@/components/InstallCard';
import BrandMark from '@/components/BrandMark';
import SignInCard from '@/components/SignInCard';

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
  car = null,
  onClearCar = null,
  appVersion = null,
  updateStatus = 'idle',
  movementEnabled = false,
  movementPending = 0,
  session = null,
  onSession = null,
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
      <div className="dayMoment">
        <BrandMark variant="glyph" size={22} aqua="var(--aqua)" className="brandMark" />
        <div>
          <b>Explore more. Stress less.</b>
          <span>Your settings — which park, theme, and what the panel shows.</span>
        </div>
      </div>

      <div className="label">How Parkbound Works</div>
      <div className="rowList">
        <button type="button" className="row" onClick={() => setHelpOpen((v) => !v)} aria-expanded={helpOpen}>
          <span className="rowText">What all this means</span>
          <span className="rowValue">{helpOpen ? 'Hide' : 'Read'}</span>
        </button>
      </div>
      {helpOpen && (
        <p className="fine block">
          Start on <b>Explore</b> — toilets, food and rides on guest walking paths. A <b>party</b> is
          optional when your expedition wants to stick together: one phone starts one and reads out
          the six-character code; everyone else types it in, scans the square, or opens the link.
          After that each phone shows the others as coloured markers, with how far away they are and
          how long it takes to walk there. <b>Side Quests</b> are on-the-ground missions for facts
          open maps cannot settle — height signs, queue entrances, closed toilets — so other guests
          benefit. A <b>meet-up</b> is one spot everybody agrees on, and anyone can set it. The phone
          that started the party <b>hosts</b> it, which only means it keeps the list — if it goes
          flat another phone picks the list up on its own, and nobody has to do anything. Nothing you
          do here is visible outside your party.
        </p>
      )}

      <div className="label">Your Name</div>
      <input
        className="field"
        maxLength={14}
        value={identity?.name === 'Guest' ? '' : identity?.name || ''}
        placeholder="Name"
        onChange={(e) => onName(e.target.value)}
        onBlur={(e) => onNameCommit(e.target.value)}
      />
      <p className="fine">Shown on the map and roster when you join a party. Solo guests can leave this blank.</p>

      <SignInCard session={session} onSession={onSession} />

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
          <span className="rowText">Which park</span>
          <span className="rowValue">{venueName || '—'}</span>
        </button>
        <button type="button" className="row" onClick={() => onPush('categories')}>
          <span className="rowText">On the map</span>
          <span className="rowValue">
            {categoryCount} of {categoryTotal}
          </span>
        </button>
        <a className="row" href="/admin/venues">
          <span className="rowText">Venue inspection</span>
          <span className="rowValue">Builder compare</span>
        </a>
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

      {onClearCar && (
        <>
          <div className="label">Where I Parked</div>
          <div className="rowList">
            {car ? (
              <button type="button" className="row" onClick={onClearCar}>
                <span className="rowText">Forget where I parked</span>
                <span className="rowValue">Saved</span>
              </button>
            ) : (
              /* Shown with nothing saved as well, because this is where the
                 feature is explained. The car button on the map says nothing
                 about itself until it has been pressed once. */
              <div className="row">
                <span className="rowText">Nothing saved</span>
                <span className="rowValue">Tap the car on the map</span>
              </div>
            )}
          </div>
          <p className="fine">
            The car button over the map saves where you are standing, and takes you back to it
            afterwards. It stays on this phone — nobody in your party is told where you parked —
            and each park remembers its own.
          </p>
        </>
      )}

      <div className="label">This Phone</div>
      <div className="rowList">
        <button type="button" className="row" onClick={onLocationSettings}>
          <span className="rowText">Location (GPS)</span>
          <span className="rowValue">
            {position ? (position.manual ? 'Placed by hand' : 'On') : 'Off — tap to enable'}
          </span>
        </button>
        <button type="button" className="row" onClick={() => onPush('movement')}>
          <span className="rowText">Walk history</span>
          <span className="rowValue">
            {movementEnabled ? 'Logging' : movementPending > 0 ? `${movementPending} to upload` : 'Off'}
          </span>
        </button>
      </div>
      {position && (
        <p className="fine">
          {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
        </p>
      )}
      <InstallCard />
      <p className="fine">
        Location drops your dot. Walk history (opt-in) keeps a private path log and ground-truth
        pins for entrances and exits you can upload to help map real midways. The Home Screen app
        keeps the park map when the midway wifi dies — we only ask when you are not already running
        from the icon.
      </p>

      <div className="label">Advanced</div>
      <div className="rowList">
        <div className="row">
          <span className="rowText">App version</span>
          <span className="rowValue">{appVersion || '—'}</span>
        </div>
        {updateStatus === 'offline' ? (
          <div className="row">
            <span className="rowText">Updates</span>
            <span className="rowValue">Offline — using cached build</span>
          </div>
        ) : null}
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
