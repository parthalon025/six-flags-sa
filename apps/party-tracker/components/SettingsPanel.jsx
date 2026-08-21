'use client';

import { useEffect, useState } from 'react';
import InstallCard from '@/components/InstallCard';
import BrandMark from '@/components/BrandMark';
import NameOnFinds from '@/components/NameOnFinds';
import SignInCard from '@/components/SignInCard';
import { creditGroups, creditsOverarchingNote } from '@/lib/credits';

const TOPICS = [
  { id: 'you', label: 'You' },
  { id: 'map', label: 'Map' },
  { id: 'phone', label: 'Phone' },
  { id: 'credits', label: 'Credits' },
  { id: 'more', label: 'More' },
];

/* Settings, arranged the way Settings is: short groups of rows, a value on the
   right of the row that has one, and a chevron on the rows that lead somewhere.
   The long tail — which categories draw, which map, what the transport is
   doing — lives behind those chevrons rather than in one column you scroll.

   This is a pushed screen under Me now, not the Me tab's root: the journey, the
   Title ladder and Collection all moved out (MePanel, WorldCloset), leaving
   this screen to be about preferences and nothing else. It draws no back
   button of its own — the sheet's navigation bar carries one. */

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
  pushState = 'idle',
  pushNeedsInstall = false,
  hiddenCards = null,
  onOpenCloset = null,
  car = null,
  onClearCar = null,
  appVersion = null,
  updateStatus = 'idle',
  movementEnabled = false,
  movementPending = 0,
  session = null,
  onSession = null,
  onWatchCompass = null,
  /** Jump straight to a topic (e.g. the on-map OSM notice opening Credits) —
   * `{ topic, nonce }`, where `nonce` changes on every request so a repeat
   * tap re-fires even if the panel is already mounted on that topic. */
  openTopic = null,
}) {
  const [topic, setTopic] = useState(openTopic?.topic || 'you');
  const [helpOpen, setHelpOpen] = useState(false);
  const [armDiag, setArmDiag] = useState(false);
  useEffect(() => {
    if (!armDiag) return undefined;
    const t = setTimeout(() => setArmDiag(false), 5000);
    return () => clearTimeout(t);
  }, [armDiag]);
  useEffect(() => {
    if (openTopic?.topic) setTopic(openTopic.topic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTopic?.nonce]);

  const pushValue =
    pushState === 'granted'
      ? `${Object.values(pushPrefs || {}).filter(Boolean).length} on`
      : pushState === 'denied'
        ? 'Blocked'
        : pushNeedsInstall
          ? 'Needs Home Screen'
          : 'Off';

  return (
    <div className="settingsPanel">
      <div className="dayMoment">
        <BrandMark variant="glyph" size={22} aqua="var(--aqua)" className="brandMark" />
        <div>
          <b>Explore more. Stress less.</b>
          <span>Your World, appearance, and this phone.</span>
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
          <div className="label eyebrow">How Parkbound works</div>
          <div className="rowList">
            <button type="button" className="row flat" onClick={() => setHelpOpen((v) => !v)} aria-expanded={helpOpen}>
              <span className="rowText">What all this means</span>
              <span className="rowValue accent">{helpOpen ? 'Hide' : 'Read'}</span>
            </button>
          </div>
          {helpOpen && (
            <p className="fine block">
              Start on <b>Explore</b> — Places, Trails and real map Zones inside your current
              World. A <b>Party</b> is your group: one phone starts one and reads out the
              six-character code, and the others type it in, scan the square, or open the link;
              after that each phone shows the rest as coloured markers with the walk to reach
              them. <b>Side Quests</b> are on-the-ground missions for facts open maps cannot
              settle — height signs, queue entrances, closed toilets. Settling one may leave a
              <b> Mark</b> at that Place: your Party sees it now, everybody else once a second
              Party Thanks it. <b>Rally</b> brings the whole group to one shared Place.
            </p>
          )}

          <div className="label eyebrow">Your name</div>
          <input
            className="field"
            maxLength={14}
            value={identity?.name === 'Guest' ? '' : identity?.name || ''}
            placeholder="Name"
            onChange={(e) => onName(e.target.value)}
            onBlur={(e) => onNameCommit(e.target.value)}
          />
          <p className="fine">Shown on the map and roster when you join a Party. Solo guests can leave this blank.</p>

          {/* The other half of "what am I called to other guests": whether a
              fact you settle carries your name. It belongs against the name
              field, not three screens away on the journey card. */}
          <NameOnFinds session={session} />

          <SignInCard session={session} onSession={onSession} />
        </>
      )}

      {topic === 'map' && (
        <>
          <div className="label eyebrow">Map appearance</div>
          {/* A tray, not three loose buttons: the segmented control reads as one
              control with a selected segment, which is what a choice of three
              exclusive options is. --fill2 is the recessed well the raised
              thumb sits in — see .tabs / .segmented. */}
          <div className="segmented tray" role="group" aria-label="Map appearance">
            {[
              ['auto', 'Automatic'],
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
            {paletteMode === 'auto'
              ? 'Trail by day, Park Midnight after dark.'
              : 'Held on one palette all day.'}{' '}
            Light suits direct sun; dark reads better once the park lights come on. Skins, in
            Collection, restyle the map paint underneath either one.
          </p>

          <div className="label eyebrow">World</div>
          <div className="rowList">
            <button type="button" className="row" onClick={() => onPush('venues')}>
              <span className="rowText">Explore Worlds</span>
              <span className="rowValue">{venueName || '—'}</span>
            </button>
            <button type="button" className="row" onClick={() => onOpenCloset?.()}>
              <span className="rowText">Collection</span>
              <span className="rowValue">Skins, Kits, Marks</span>
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
          {/* One list, five rows. Each row says what it is for underneath its
              own name, and the two that have more to say than a value — which
              notifications, which hidden cards — lead to their own screen
              rather than unrolling four more rows into this one. */}
          <div className="label eyebrow">This phone</div>
          <div className="rowList">
            <button type="button" className="row flat" onClick={onLocationSettings}>
              <span className="rowText">
                Location (GPS)
                <span className="fine">Drops your dot on the World</span>
              </span>
              <span className={`rowValue ${position ? 'accent' : ''}`}>
                {position ? (position.manual ? 'Placed by hand' : 'On') : 'Off'}
              </span>
            </button>
            <button type="button" className="row" onClick={() => onPush('movement')}>
              <span className="rowText">
                Walk history
                <span className="fine">Private path log, opt-in</span>
              </span>
              <span className="rowValue">
                {movementEnabled ? 'Logging' : movementPending > 0 ? `${movementPending} to upload` : 'Off'}
              </span>
            </button>
            {pushKinds && (
              <button type="button" className="row" onClick={() => onPush('notifications')}>
                <span className="rowText">
                  Notifications
                  <span className="fine">When somebody needs you</span>
                </span>
                <span className="rowValue">{pushValue}</span>
              </button>
            )}
            <button type="button" className="row" onClick={() => onPush('hidden-cards')}>
              <span className="rowText">
                What the panel shows
                <span className="fine">Clears hides from an older Explore panel</span>
              </span>
              <span className="rowValue">
                {hiddenCards?.length ? `${hiddenCards.length} hidden` : 'All showing'}
              </span>
            </button>
            {onClearCar && (
              <button
                type="button"
                className="row flat"
                onClick={car ? onClearCar : undefined}
                aria-disabled={!car}
              >
                <span className="rowText">
                  Where I parked
                  <span className="fine">Stays on this phone</span>
                </span>
                <span className="rowValue">{car ? 'Saved · tap to forget' : 'Nothing saved'}</span>
              </button>
            )}
          </div>
          {position && (
            <p className="fine coordLine">
              {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
            </p>
          )}

          <InstallCard />
          <p className="fine">
            Location drops your dot; nobody in your Party is told where you parked. Walk history
            keeps a private path log and ground-truth pins for entrances and exits you can upload
            to help map real midways. The Home Screen app keeps the park map when the midway wifi
            dies — we only ask when you are not already running from the icon.
          </p>
        </>
      )}

      {topic === 'credits' && (
        <>
          <p className="fine">{creditsOverarchingNote()}</p>
          {creditGroups().map((group) => (
            <div key={group.role}>
              <div className="label eyebrow">{group.label}</div>
              <div className="rowList">
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    className="row"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="rowText">
                      {item.name}
                      {item.detail ? ` — ${item.detail}` : ''}
                    </span>
                    <span className="rowValue">{item.license}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
          <p className="fine block">
            The map itself is drawn from OpenStreetMap geometry — see the “© OpenStreetMap
            contributors” notice over the map, which opens back here.
          </p>
        </>
      )}

      {topic === 'more' && (
        <>
          <div className="label eyebrow">Advanced</div>
          <div className="rowList">
            <a href="/privacy" className="row">
              <span className="rowText">Privacy</span>
              <span className="rowValue">What we collect</span>
            </a>
            <div className="row flat">
              <span className="rowText">App version</span>
              {/* Never a literal. The version is stamped on merge — see the
                  version-on-merge policy — and appUpdate.version is what this
                  build actually is. */}
              <span className="rowValue">{appVersion || '—'}</span>
            </div>
            {updateStatus === 'offline' ? (
              <div className="row flat">
                <span className="rowText">Updates</span>
                <span className="rowValue">Offline — using cached build</span>
              </div>
            ) : null}
            {/* Two taps, deliberately. Diagnostics is a fault-finding screen
                nobody opens on purpose from a midway, and a plain chevron here
                put it one stray thumb away from the Privacy link above it. */}
            <button
              type="button"
              className="row flat"
              onClick={() => (armDiag ? onPush('diagnostics') : setArmDiag(true))}
            >
              <span className="rowText">Diagnostics</span>
              <span className={`rowValue ${armDiag ? 'accent' : ''}`}>
                {armDiag ? 'Tap again to open' : 'For fault-finding'}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
