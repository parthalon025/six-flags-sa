'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

const VARIANTS = [
  { id: 'atlas', label: 'A', name: 'Park Atlas' },
  { id: 'board', label: 'B', name: 'Gameboard' },
  { id: 'quest', label: 'C', name: 'Questline' },
];

const LANDS = [
  { name: 'CONEY MALL', x: 180, y: 180, rotate: -8 },
  { name: 'AREA 72', x: 670, y: 130, rotate: 5 },
  { name: 'RIVERTOWN', x: 690, y: 520, rotate: -4 },
];

const PLACES = [
  { name: 'Flight of Fear', kind: 'ride', x: 680, y: 260, tone: 'orange', glyph: '↗' },
  { name: 'The Zephyr', kind: 'ride', x: 340, y: 380, tone: 'violet', glyph: '↗' },
  { name: 'Juke Box Diner', kind: 'food', x: 500, y: 520, tone: 'yellow', glyph: '✦' },
  { name: 'You are here', kind: 'me', x: 440, y: 300, tone: 'teal', glyph: '●' },
];

function MapArtwork({ mode, variant }) {
  const pixel = mode === 'pixel';
  return (
    <svg
      className={`${styles.mapArtwork} ${pixel ? styles.pixelMap : styles.baseMap}`}
      viewBox="0 0 1000 700"
      role="img"
      aria-label={`${pixel ? 'Pixel Tycoon' : 'Park Atlas'} ${variant} map prototype`}
    >
      <defs>
        <pattern id="pixel-grid" width="72" height="72" patternUnits="userSpaceOnUse">
          <rect width="72" height="72" fill="#62bd4b" />
          <rect width="36" height="36" fill="#57ad43" />
          <rect x="36" y="36" width="36" height="36" fill="#57ad43" />
        </pattern>
        <linearGradient id="atlas-ground" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b8dfb8" />
          <stop offset="1" stopColor="#76b894" />
        </linearGradient>
        <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" floodOpacity=".18" />
        </filter>
      </defs>

      <rect width="1000" height="700" fill={pixel ? 'url(#pixel-grid)' : 'url(#atlas-ground)'} />
      <path className={styles.water} d="M0 80 C190 35 245 150 405 105 S700 35 1000 120 V0H0Z" />
      <path className={styles.parkBoundary} d="M95 80 L920 72 L940 618 L62 630Z" />

      <g className={styles.landPatches}>
        <path d="M120 120 L430 85 L470 255 L160 290Z" />
        <path d="M530 90 L875 120 L828 290 L510 250Z" />
        <path d="M120 365 L405 325 L475 595 L95 620Z" />
        <path d="M535 345 L870 300 L905 600 L520 595Z" />
      </g>

      <g className={styles.paths}>
        <path d="M110 320 C270 290 350 350 475 300 S690 200 900 285" />
        <path d="M475 300 C500 370 540 420 520 600" />
        <path d="M250 120 C300 220 290 250 340 380 S430 480 500 520" />
        <path d="M700 115 C650 190 660 245 680 260" />
      </g>

      <g className={styles.coasterLayer}>
        <path d="M555 145 C650 185 650 230 720 250 S850 240 900 170" />
        <path d="M205 440 C290 400 320 450 390 470 S500 445 590 465" />
      </g>

      <g className={styles.buildingLayer}>
        <path d="M625 215 710 190 760 220 675 250Z" />
        <path d="M625 215v58l50 32v-55Z" />
        <path d="M675 250v55l85-34v-51Z" />
        <path d="M455 475 560 450 610 480 505 510Z" />
        <path d="M455 475v50l50 30v-45Z" />
        <path d="M505 510v45l105-35v-40Z" />
      </g>

      <g className={styles.landLabels}>
        {LANDS.map((land) => (
          <text
            key={land.name}
            x={land.x}
            y={land.y}
            transform={`rotate(${land.rotate} ${land.x} ${land.y})`}
          >
            {land.name}
          </text>
        ))}
      </g>

      <g className={styles.placeLayer}>
        {PLACES.map((place) => (
          <g key={place.name} transform={`translate(${place.x} ${place.y})`}>
            <circle className={`${styles.placeHalo} ${styles[place.tone]}`} r="25" />
            <circle className={`${styles.placeMarker} ${styles[place.tone]}`} r="17" />
            <text className={styles.placeGlyph} textAnchor="middle" y="6">
              {place.glyph}
            </text>
            {place.name !== 'You are here' && (
              <text className={styles.placeName} x="31" y="5">
                {place.name}
              </text>
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}

function AtlasChrome({ mode }) {
  return (
    <>
      <div className={styles.atlasTop}>
        <div className={styles.brandMark}><span>PB</span> PARK BOUND</div>
        <div className={styles.statusPill}><span className={styles.liveDot} /> LIVE MAP</div>
        <button className={styles.iconButton} aria-label="Open map key">?</button>
      </div>
      <div className={styles.atlasKey}>
        <span><i className={styles.keyRide} /> Rides</span>
        <span><i className={styles.keyFood} /> Food</span>
        <span><i className={styles.keyMe} /> You</span>
      </div>
      <div className={styles.atlasDock}>
        <div>
          <span className={styles.eyebrow}>NEXT STOP</span>
          <strong>Flight of Fear</strong>
          <span className={styles.muted}>Area 72 · 4 min walk</span>
        </div>
        <button className={styles.primaryButton}>{mode === 'pixel' ? 'GO NOW ↗' : 'GO NOW'}</button>
      </div>
    </>
  );
}

function BoardChrome() {
  return (
    <>
      <div className={styles.boardTop}>
        <div>
          <span className={styles.eyebrow}>PARK DAY 04</span>
          <strong>12:42 PM</strong>
        </div>
        <div className={styles.coin}><span>✦</span> 1,240 XP</div>
      </div>
      <div className={styles.boardMission}>
        <span className={styles.missionIcon}>↗</span>
        <div><span className={styles.eyebrow}>ACTIVE MISSION</span><strong>Find Flight of Fear</strong></div>
        <span className={styles.missionStep}>2/3</span>
      </div>
      <div className={styles.boardCard}>
        <span className={styles.eyebrow}>SELECTED PLACE</span>
        <strong>Flight of Fear</strong>
        <span className={styles.muted}>Indoor launch coaster · Area 72</span>
        <div className={styles.cardActions}><button className={styles.primaryButton}>NAVIGATE</button><button className={styles.ghostButton}>DETAILS</button></div>
      </div>
    </>
  );
}

function QuestChrome() {
  return (
    <>
      <div className={styles.questTop}>
        <div className={styles.questAvatar}>A</div>
        <div><strong>AVA&apos;S PARK DAY</strong><span>Ranger · 1,240 XP</span></div>
        <button className={styles.iconButton} aria-label="Open menu">•••</button>
      </div>
      <div className={styles.questBanner}>
        <span className={styles.questFlag}>✦</span>
        <div><span className={styles.eyebrow}>UP NEXT</span><strong>Reach Area 72</strong><span>Follow the bright route to unlock a map stamp.</span></div>
        <span className={styles.bannerArrow}>›</span>
      </div>
      <div className={styles.questRail}>
        <button className={styles.railButton}><b>⌖</b><span>NEARBY</span></button>
        <button className={`${styles.railButton} ${styles.railActive}`}><b>✦</b><span>QUESTS</span></button>
        <button className={styles.railButton}><b>♧</b><span>PARTY</span></button>
      </div>
      <div className={styles.questBottom}>
        <span className={styles.eyebrow}>MAP STAMP 03</span>
        <strong>Area 72 discovered</strong>
        <span className={styles.muted}>Two places nearby · 8 min left on route</span>
      </div>
    </>
  );
}

function PrototypeSwitcher({ variant, mode, setVariant, setMode }) {
  const current = VARIANTS.find((item) => item.id === variant) || VARIANTS[0];
  const changeVariant = (direction) => {
    const index = VARIANTS.findIndex((item) => item.id === current.id);
    const next = (index + direction + VARIANTS.length) % VARIANTS.length;
    setVariant(VARIANTS[next].id);
  };
  return (
    <div className={styles.prototypeBar}>
      <button onClick={() => changeVariant(-1)} aria-label="Previous variant">‹</button>
      <div><b>{current.label} — {current.name}</b><span>PROTOTYPE</span></div>
      <button onClick={() => changeVariant(1)} aria-label="Next variant">›</button>
      <div className={styles.modeToggle}>
        <button className={mode === 'base' ? styles.modeActive : ''} onClick={() => setMode('base')}>BASE</button>
        <button className={mode === 'pixel' ? styles.modeActive : ''} onClick={() => setMode('pixel')}>PIXEL</button>
      </div>
    </div>
  );
}

export default function MapPolishPrototype() {
  const [variant, setVariant] = useState(() => {
    if (typeof window === 'undefined') return 'atlas';
    const candidate = new URLSearchParams(window.location.search).get('variant');
    return VARIANTS.some((item) => item.id === candidate) ? candidate : 'atlas';
  });
  const [mode, setMode] = useState(() => {
    if (typeof window === 'undefined') return 'base';
    return new URLSearchParams(window.location.search).get('mode') === 'pixel' ? 'pixel' : 'base';
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('variant', variant);
    params.set('mode', mode);
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [variant, mode]);

  return (
    <main className={`${styles.prototype} ${styles[`variant${variant}`]} ${mode === 'pixel' ? styles.modePixel : styles.modeBase}`}>
      <div className={styles.prototypeLabel}>MAP POLISH LAB · THROWAWAY PROTOTYPE</div>
      <section className={styles.mapFrame}>
        <MapArtwork mode={mode} variant={variant} />
        {variant === 'board' ? <BoardChrome /> : variant === 'quest' ? <QuestChrome /> : <AtlasChrome mode={mode} />}
        <div className={styles.zoomRail}><button>+</button><button>−</button><button>⌖</button></div>
      </section>
      <PrototypeSwitcher variant={variant} mode={mode} setVariant={setVariant} setMode={setMode} />
    </main>
  );
}
