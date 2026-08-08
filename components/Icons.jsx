'use client';

/* Glyphs, drawn the way the platform draws them: one 24-unit box, a
   1.7 stroke with round caps and joins, and no fill unless the shape
   is meant to read as solid. Everything takes its colour from
   `currentColor`, so a glyph inherits whatever state its button is in
   rather than carrying a colour of its own.

   Tab glyphs come in two weights. Outlined is the tab you are not on;
   solid is the one you are — the same convention a tab bar uses on
   the platform, and the reason the tab bar below needs no underline. */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function Svg({ children, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

/* ---- the header ---- */

/** Switch to the night map. */
export function MoonIcon() {
  return (
    <Svg>
      <path
        {...stroke}
        d="M20.2 14.2A8.4 8.4 0 0 1 9.8 3.8a8.4 8.4 0 1 0 10.4 10.4Z"
      />
    </Svg>
  );
}

/** Switch to the daylight map. */
export function SunIcon() {
  return (
    <Svg>
      <circle {...stroke} cx="12" cy="12" r="4.2" />
      <path
        {...stroke}
        d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6 6 18M18 6l1.6-1.6"
      />
    </Svg>
  );
}

/** The bearing tape: a compass rose. */
export function CompassIcon() {
  return (
    <Svg>
      <circle {...stroke} cx="12" cy="12" r="9" />
      <path {...stroke} d="m15.6 8.4-1.9 5.3-5.3 1.9 1.9-5.3Z" fill="currentColor" />
    </Svg>
  );
}

/* ---- the round buttons on the map ---- */

/** Drop the meet-up point. */
export function FlagIcon() {
  return (
    <Svg>
      <path {...stroke} d="M6 21V4" />
      <path
        {...stroke}
        d="M6 4.6h10.9c.5 0 .8.6.5 1l-2.2 3c-.2.3-.2.6 0 .9l2.2 3c.3.4 0 1-.5 1H6Z"
        fill="currentColor"
        fillOpacity=".18"
      />
    </Svg>
  );
}

/** Centre the map on me. */
export function LocateIcon() {
  return (
    <Svg>
      <circle {...stroke} cx="12" cy="12" r="4" />
      <path {...stroke} d="M12 1.8v3.4M12 18.8v3.4M22.2 12h-3.4M5.2 12H1.8" />
      <circle {...stroke} cx="12" cy="12" r="8.2" />
    </Svg>
  );
}

/* ---- the zoom pad ---- */

export function PlusIcon() {
  return (
    <Svg>
      <path {...stroke} strokeWidth="2" d="M12 5.5v13M5.5 12h13" />
    </Svg>
  );
}

export function MinusIcon() {
  return (
    <Svg>
      <path {...stroke} strokeWidth="2" d="M5.5 12h13" />
    </Svg>
  );
}

/* ---- the sound toggle while walking ---- */

export function SpeakerIcon({ muted = false }) {
  return (
    <Svg width="21" height="21">
      <path
        {...stroke}
        d="M11.4 4.3 6.9 8.1H3.8v7.8h3.1l4.5 3.8Z"
        fill="currentColor"
        fillOpacity=".22"
      />
      {muted ? (
        <path {...stroke} d="m15.4 9.6 4.8 4.8M20.2 9.6l-4.8 4.8" />
      ) : (
        <path {...stroke} d="M15.4 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.8 7.8 0 0 1 0 10.8" />
      )}
    </Svg>
  );
}

/* ---- the tab bar ---- */

/** Directions — a route that turns. */
export function RouteIcon({ filled = false }) {
  return (
    <Svg>
      <path {...stroke} d="M5 20v-6.5A3.5 3.5 0 0 1 8.5 10H17" />
      <path
        {...stroke}
        d="m14.2 6.4 3.6 3.6-3.6 3.6Z"
        fill={filled ? 'currentColor' : 'none'}
      />
      <circle {...stroke} cx="5" cy="20" r="1.6" fill={filled ? 'currentColor' : 'none'} />
    </Svg>
  );
}

/** Party — the people you came with. */
export function PeopleIcon({ filled = false }) {
  const solid = filled ? { fill: 'currentColor' } : {};
  return (
    <Svg>
      <circle {...stroke} {...solid} cx="9.2" cy="7.6" r="3.4" />
      <path {...stroke} {...solid} d="M3 19.4c0-3 2.8-5 6.2-5s6.2 2 6.2 5Z" />
      <path {...stroke} d="M16.4 5.1a3.4 3.4 0 0 1 0 6.6M17.6 14.9c2.1.6 3.6 2.2 3.6 4.5h-3.4" />
    </Svg>
  );
}

/** Rides and places — a pin on the map. */
export function PinIcon({ filled = false }) {
  return (
    <Svg>
      <path
        {...stroke}
        d="M12 21.4c3.7-4.7 6.2-8 6.2-11a6.2 6.2 0 1 0-12.4 0c0 3 2.5 6.3 6.2 11Z"
        fill={filled ? 'currentColor' : 'none'}
      />
      <circle
        cx="12"
        cy="10.2"
        r="2.4"
        fill={filled ? 'var(--mat-thick, #fff)' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </Svg>
  );
}

/** Me — this phone, and the settings that belong to it. */
export function PersonIcon({ filled = false }) {
  const solid = filled ? { fill: 'currentColor' } : {};
  return (
    <Svg>
      <circle {...stroke} cx="12" cy="12" r="9" />
      <circle {...stroke} {...solid} cx="12" cy="9.6" r="3.1" />
      <path {...stroke} {...solid} d="M6.3 19.2c.7-2.6 2.9-4.1 5.7-4.1s5 1.5 5.7 4.1" />
    </Svg>
  );
}

/** The glyph a tab shows, by tab key. */
export const TAB_ICONS = {
  route: RouteIcon,
  party: PeopleIcon,
  rides: PinIcon,
  me: PersonIcon,
};
