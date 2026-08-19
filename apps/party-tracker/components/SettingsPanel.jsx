'use client';

import { useEffect, useState } from 'react';
import InstallCard from '@/components/InstallCard';
import BrandMark from '@/components/BrandMark';
import SignInCard from '@/components/SignInCard';
import WorldCloset from '@/components/WorldCloset';

const TOPICS = [
  { id: 'you', label: 'You' },
  { id: 'map', label: 'Map' },
  { id: 'phone', label: 'Phone' },
  { id: 'more', label: 'More' },
];

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
  paletteMode = 'auto',
  onPaletteMode = null,
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
  worldProgress = null,
  world = null,
  acceptedOffer = null,
  selfId = null,
  venue = null,
  onWearOwn = null,
  onAcceptOffer = null,
  onClearWear = null,
  onOfferSkin = null,
  onWithdrawOffer = null,
  onEquipKit = null,
  onDropMark = null,
  onWatchCompass = null,
}) {
  const [topic, setTopic] = useState('you');
  const [helpOpen, setHelpOpen] = useState(false);
  const [armDiag, setArmDiag] = useState(false);
  useEffect(() => {
    if (!armDiag) return undefined;
    const t = setTimeout(() => setArmDiag(false), 5000);
    return () => clearTimeout(t);
  }, [armDiag]);

  return (
    <div className="settingsPanel">
      <div className="dayMoment">
        <BrandMark variant="glyph" size={22} aqua="var(--aqua)" className="brandMark" />
        <div>
          <b>Explore more. Stress less.</b>
          <span>Your settings — selected World, theme, and what the panel shows.</span>
        </div>
      </div>

      <div className="settingsTopics" role="tablist" aria-label="Settings topics">
        {TOPICS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={`settingsTopic ${topic === t.id ? 'on' : ''}`}
            aria-selected={topic === t.id}
            onClick={() => setTopic(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {topic === 'you' && (
        <>
          <div className="label">How Parkbound Works</div>
          <div className="rowList">
            <button type="button" className="row" onClick={() => setHelpOpen((v) => !v)} aria-expanded={helpOpen}>
              <span className="rowText">What all this means</span>
              <span className="rowValue">{helpOpen ? 'Hide' : 'Read'}</span>
            </button>
          </div>
          {helpOpen && (
            <p className="fine block">
              Start on <b>Explore</b> — Places, routes, and real map Zones inside your current World. A <b>Party is your group</b>:
              optional when your group wants to stay together: one phone starts one and reads out
              the six-character code; everyone else types it in, scans the square, or opens the link.
              After that each phone shows the others as coloured markers, with how far away they are and
              how long it takes to walk there. <b>Side Quests</b> are on-the-ground missions for facts
              open maps cannot settle — height signs, queue entrances, closed toilets — so other guests
              benefit. Completing one may leave a <b>Mark</b> at that Place — your Party sees it
              now, and other guests after a second Party Thanks it. Kits and live GPS stay in your
              Party. <b>Rally</b> brings everyone to one shared Place. The phones
              keep a shared list on their own — if one goes flat another picks it up, and nobody has to
              do anything. Live ride marks stay in your party until a second party walks by.
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
        </>
      )}

      {topic === 'map' && (
        <>
          <div className="label">Map Appearance</div>
          <div className="segmented" role="group" aria-label="Map appearance">
            {[
              ['auto', 'Auto'],
              ['day', 'Light'],
              ['night', 'Dark'],
            ].map(([key, labelText]) => (
              <button
                key={key}
                type="button"
                className={`tab ${paletteMode === key ? 'on' : ''}`}
                aria-pressed={paletteMode === key}
                onClick={() => onPaletteMode?.(key)}
              >
                {labelText}
              </button>
            ))}
          </div>
          <p className="fine">
            Auto follows local sunset (Trail by day, Park Midnight after dark). Light is best outdoors;
            Dark is easier once park lights come on. Skins below restyle the map paint.
          </p>

          <WorldCloset
            progress={worldProgress}
            world={world}
            acceptedOffer={acceptedOffer}
            selfId={selfId}
            session={session}
            venue={venue}
            position={position}
            onWearOwn={onWearOwn}
            onAcceptOffer={onAcceptOffer}
            onClearWear={onClearWear}
            onOffer={onOfferSkin}
            onWithdraw={onWithdrawOffer}
            onEquipKit={onEquipKit}
            onDropMark={onDropMark}
          />

          <div className="label">Explore Worlds</div>
          <div className="rowList">
            <button type="button" className="row" onClick={() => onPush('venues')}>
              <span className="rowText">Explore Worlds</span>
              <span className="rowValue">{venueName || '—'}</span>
            </button>
            {onWatchCompass && (
              <button type="button" className="row" onClick={onWatchCompass}>
                <span className="rowText">Watch Compass</span>
                <span className="rowValue">Settings</span>
              </button>
            )}
            <button type="button" className="row" onClick={() => onPush('categories')}>
              <span className="rowText">On the map</span>
              <span className="rowValue">
                {categoryCount} of {categoryTotal}
              </span>
            </button>
            <a className="row" href="/admin/venues">
              <span className="rowText">World inspection</span>
              <span className="rowValue">Builder compare</span>
            </a>
          </div>
        </>
      )}

      {topic === 'phone' && (
        <>
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
        </>
      )}

      {topic === 'more' && (
        <>
          <div className="label">Advanced</div>
          <div className="rowList">
            <a href="/privacy" className="row">
              <span className="rowText">Privacy</span>
              <span className="rowValue">What we collect</span>
            </a>
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
            <button
              type="button"
              className="row"
              onClick={() => (armDiag ? onPush('diagnostics') : setArmDiag(true))}
            >
              <span className="rowText">Diagnostics</span>
              <span className="rowValue">{armDiag ? 'Tap again to open' : 'For fault-finding'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
