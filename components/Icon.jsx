/* SF Symbols are Apple's, and not licensed for the web — so these are drawn to
   match rather than imported: the same 24-unit box, the same rounded stroke
   ends, the same optical weight. Names match the symbols they stand in for, so
   swapping any one of them for the real thing later is a one-line change.

   Everything paints in `currentColor`, which is what lets a button tint its
   glyph by setting `color` and nothing else. */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const GLYPHS = {
  'moon.fill': (
    <path
      d="M20.4 14.6A8.9 8.9 0 0 1 9.4 3.6 9 9 0 1 0 20.4 14.6Z"
      fill="currentColor"
    />
  ),
  'sun.max.fill': (
    <>
      <circle cx="12" cy="12" r="4.4" fill="currentColor" />
      <g {...STROKE} strokeWidth="2.1">
        <path d="M12 2.4v2.2M12 19.4v2.2M21.6 12h-2.2M4.6 12H2.4" />
        <path d="M18.8 5.2 17.2 6.8M6.8 17.2 5.2 18.8M18.8 18.8 17.2 17.2M6.8 6.8 5.2 5.2" />
      </g>
    </>
  ),
  safari: (
    <>
      <circle cx="12" cy="12" r="9.1" {...STROKE} strokeWidth="1.9" />
      <path d="M16.4 7.6 10.9 10.9 7.6 16.4 13.1 13.1Z" fill="currentColor" />
    </>
  ),
  'mappin.and.ellipse': (
    <>
      <path
        d="M12 2.6a5.6 5.6 0 0 0-5.6 5.6c0 4 5.6 9.4 5.6 9.4s5.6-5.4 5.6-9.4A5.6 5.6 0 0 0 12 2.6Z"
        fill="currentColor"
      />
      <circle cx="12" cy="8.2" r="2.1" fill="var(--bg3, #fff)" />
      <ellipse cx="12" cy="19.6" rx="6.4" ry="2.1" {...STROKE} strokeWidth="1.7" />
    </>
  ),
  'location.fill': (
    <path
      d="M20.8 3.9 4.3 10.6c-1.2.5-1 2.2.2 2.5l6.1 1.4 1.4 6.1c.3 1.2 2 1.4 2.5.2l6.7-16.5c.4-1-.5-1.8-1.4-1.4Z"
      fill="currentColor"
    />
  ),
  'location.north.fill': <path d="M12 2.8 19 20.4 12 16.6 5 20.4Z" fill="currentColor" />,
  'speaker.wave.2.fill': (
    <>
      <path
        d="M11.4 3.6 6.6 7.6H3.4a1 1 0 0 0-1 1v6.8a1 1 0 0 0 1 1h3.2l4.8 4a.9.9 0 0 0 1.5-.7V4.3a.9.9 0 0 0-1.5-.7Z"
        fill="currentColor"
      />
      <g {...STROKE} strokeWidth="1.9">
        <path d="M16.4 9.2a4 4 0 0 1 0 5.6" />
        <path d="M19.2 6.4a8 8 0 0 1 0 11.2" />
      </g>
    </>
  ),
  'speaker.slash.fill': (
    <>
      <path
        d="M11.4 3.6 6.6 7.6H3.4a1 1 0 0 0-1 1v6.8a1 1 0 0 0 1 1h3.2l4.8 4a.9.9 0 0 0 1.5-.7V4.3a.9.9 0 0 0-1.5-.7Z"
        fill="currentColor"
      />
      <g {...STROKE} strokeWidth="1.9">
        <path d="M16.6 9.6 21.4 14.4M21.4 9.6 16.6 14.4" />
      </g>
    </>
  ),
  plus: <path d="M12 5.4v13.2M5.4 12h13.2" {...STROKE} strokeWidth="2.2" />,
  minus: <path d="M5.4 12h13.2" {...STROKE} strokeWidth="2.2" />,
  magnifyingglass: (
    <g {...STROKE} strokeWidth="2.1">
      <circle cx="10.6" cy="10.6" r="6.4" />
      <path d="M15.4 15.4 20.6 20.6" />
    </g>
  ),
  'xmark.circle.fill': (
    <>
      <circle cx="12" cy="12" r="9.4" fill="currentColor" />
      <path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="var(--bg2, #fff)" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  checkmark: <path d="M4.8 12.6 9.6 17.4 19.2 6.6" {...STROKE} strokeWidth="2.4" />,
  'chevron.left': <path d="M15 4.5 7.5 12 15 19.5" {...STROKE} strokeWidth="2.6" />,
  'chevron.right': <path d="M9 4.5 16.5 12 9 19.5" {...STROKE} strokeWidth="2.6" />,
  'chevron.up': <path d="M4.5 15 12 7.5 19.5 15" {...STROKE} strokeWidth="2.6" />,
  xmark: <path d="M6 6l12 12M18 6 6 18" {...STROKE} strokeWidth="2.4" />,
  'qrcode.viewfinder': (
    <g {...STROKE} strokeWidth="2">
      <path d="M3.4 8.2V5.4a2 2 0 0 1 2-2h2.8M15.8 3.4h2.8a2 2 0 0 1 2 2v2.8M20.6 15.8v2.8a2 2 0 0 1-2 2h-2.8M8.2 20.6H5.4a2 2 0 0 1-2-2v-2.8" />
      <path d="M8.4 8.4h2.2v2.2H8.4zM13.4 8.4h2.2v2.2h-2.2zM8.4 13.4h2.2v2.2H8.4zM13.4 13.4h2.2v2.2h-2.2z" />
    </g>
  ),
  /* The tab bar's glyphs. Filled rather than outlined, because a tab bar is
     read at a glance from the bottom of the screen and an outline at 24px
     dissolves into the glass behind it. */
  'person.2.fill': (
    <>
      {/* the one standing behind, drawn first so the front one overlaps it */}
      <circle cx="17" cy="8.6" r="3" fill="currentColor" opacity=".55" />
      <path
        d="M15.8 13.8c3.4 0 5.8 1.7 5.8 4.4a.9.9 0 0 1-.9.9h-3.4c.1-.4.1-.8.1-1.2 0-1.7-.6-3.1-1.6-4.1Z"
        fill="currentColor"
        opacity=".55"
      />
      <circle cx="9.4" cy="7.8" r="3.8" fill="currentColor" />
      <path
        d="M2.4 19.4c0-3.4 3.1-5.4 7-5.4s7 2 7 5.4a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1Z"
        fill="currentColor"
      />
    </>
  ),
  /* A coaster: one hill, and a car cresting it. The height screen is about
     what a rider can get on, so the glyph is the ride rather than a ruler. */
  'figure.rollercoaster': (
    <>
      <path d="M2.4 20c3.6 0 3.6-9 9.6-9s6 9 9.6 9" {...STROKE} strokeWidth="1.9" />
      <rect x="8.2" y="4.4" width="7.6" height="4.9" rx="1.5" fill="currentColor" />
      <circle cx="10.2" cy="10" r="1.15" fill="currentColor" />
      <circle cx="13.8" cy="10" r="1.15" fill="currentColor" />
    </>
  ),
  'person.crop.circle.fill': (
    <>
      <circle cx="12" cy="12" r="9.4" fill="currentColor" />
      <circle cx="12" cy="9.8" r="3.1" fill="var(--bg2, #fff)" />
      <path
        d="M5.9 18.6a9.4 9.4 0 0 0 12.2 0c-1-2.1-3.4-3.3-6.1-3.3s-5.1 1.2-6.1 3.3Z"
        fill="var(--bg2, #fff)"
      />
    </>
  ),
  'camera.fill': (
    <>
      <path
        d="M9.4 4.4a1.4 1.4 0 0 0-1.2.7l-.9 1.5H4.6a2.2 2.2 0 0 0-2.2 2.2v8.6a2.2 2.2 0 0 0 2.2 2.2h14.8a2.2 2.2 0 0 0 2.2-2.2V8.8a2.2 2.2 0 0 0-2.2-2.2h-2.7l-.9-1.5a1.4 1.4 0 0 0-1.2-.7Z"
        fill="currentColor"
      />
      <circle cx="12" cy="13.2" r="3.4" fill="var(--bg2, #fff)" />
    </>
  ),
  'car.fill': (
    <path
      d="M5.4 11.4 6.9 6.6A2.6 2.6 0 0 1 9.4 4.8h5.2a2.6 2.6 0 0 1 2.5 1.8l1.5 4.8a2.6 2.6 0 0 1 1.8 2.5v3.4a1.3 1.3 0 0 1-1.3 1.3h-1a1.3 1.3 0 0 1-1.3-1.3v-.9H7.2v.9a1.3 1.3 0 0 1-1.3 1.3h-1a1.3 1.3 0 0 1-1.3-1.3v-3.4a2.6 2.6 0 0 1 1.8-2.5ZM7.6 11h8.8l-1-3.2a.9.9 0 0 0-.8-.6H9.4a.9.9 0 0 0-.8.6ZM6.6 13.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM17.4 13.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"
      fill="currentColor"
      fillRule="evenodd"
    />
  ),
  'phone.fill': (
    <path
      d="M6.1 2.6a1.9 1.9 0 0 1 2.6.5l1.9 2.7a1.9 1.9 0 0 1-.3 2.5l-1.2 1a11.6 11.6 0 0 0 5.6 5.6l1-1.2a1.9 1.9 0 0 1 2.5-.3l2.7 1.9a1.9 1.9 0 0 1 .5 2.6l-1.2 1.8a2.6 2.6 0 0 1-3 1C13.3 20.9 6.9 15 4.4 8.4a2.6 2.6 0 0 1 1-3Z"
      fill="currentColor"
    />
  ),
};

/**
 * @param name  an SF Symbol name from GLYPHS
 * @param size  edge length in px; the box is always 24 units
 */
export default function Icon({ name, size = 22, className = 'icn' }) {
  const glyph = GLYPHS[name];
  if (!glyph) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  );
}
