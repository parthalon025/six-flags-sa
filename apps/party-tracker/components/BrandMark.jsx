'use client';

/**
 * PARKBOUND waypoint marks — two canonical forms from the brand sheet.
 *
 * - lockup: full Modern Waypoint (teal diamond + orange compass eye + orange
 *   corner arrows + teal pin tail). Pairs with the wordmark in BrandLockup.
 * - glyph: simplified mark for small sizes (teal frame with corner gaps,
 *   orange center, teal outward arrows). App icon, notifications, map pins.
 *
 * Do not invent a third silhouette — adapt size/colour, not geometry.
 */

const LOCKUP_COLORS = {
  aqua: '#27B8B0',
  adventure: '#FF6B35',
  midnight: '#10233F',
};

/** Full signature mark — lockup / splash / marketing. */
function LockupMark({ size = 40, title }) {
  const { aqua, adventure } = LOCKUP_COLORS;
  return (
    <svg
      width={size}
      height={size * (72 / 64)}
      viewBox="0 0 64 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
    >
      {title ? <title>{title}</title> : null}
      {/* Pin tail */}
      <path d="M32 52 L38 62 L32 70 L26 62 Z" fill={aqua} />
      {/* Diamond frame */}
      <path
        d="M32 6 L54 32 L32 58 L10 32 Z"
        fill="none"
        stroke={aqua}
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      {/* Orange compass eye */}
      <circle cx="32" cy="30" r="7.5" fill={adventure} />
      {/* Four orange arrows toward corners */}
      <path d="M32 14 L35.2 20.5 H28.8 Z" fill={adventure} />
      <path d="M48 32 L41.5 28.8 V35.2 Z" fill={adventure} />
      <path d="M32 46 L28.8 39.5 H35.2 Z" fill={adventure} />
      <path d="M16 32 L22.5 35.2 V28.8 Z" fill={adventure} />
    </svg>
  );
}

/** Simplified glyph — app icon, status bar, live map destinations. */
function GlyphMark({
  size = 24,
  aqua = 'currentColor',
  adventure = '#FF6B35',
  title,
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
    >
      {title ? <title>{title}</title> : null}
      {/* Diamond sides with corner gaps for the arrows */}
      <path
        d="M22 14 L32 6 L42 14 M50 22 L58 32 L50 42 M42 50 L32 58 L22 50 M14 42 L6 32 L14 22"
        stroke={aqua}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Teal outward arrows through corner gaps */}
      <path d="M32 2 L35.4 9.2 H28.6 Z" fill={aqua} />
      <path d="M62 32 L54.8 28.6 V35.4 Z" fill={aqua} />
      <path d="M32 62 L28.6 54.8 H35.4 Z" fill={aqua} />
      <path d="M2 32 L9.2 35.4 V28.6 Z" fill={aqua} />
      {/* Orange center */}
      <circle cx="32" cy="32" r="8" fill={adventure} />
    </svg>
  );
}

/**
 * @param {'lockup' | 'glyph'} variant
 * @param {number} [size]
 * @param {string} [className]
 * @param {string} [aqua] glyph stroke/arrow colour (CSS colour or currentColor)
 * @param {string} [adventure] center-circle colour
 * @param {string} [title] accessible name; omit for decorative
 */
export default function BrandMark({
  variant = 'glyph',
  size = 24,
  className,
  aqua,
  adventure,
  title,
}) {
  const mark =
    variant === 'lockup' ? (
      <LockupMark size={size} title={title} />
    ) : (
      <GlyphMark size={size} aqua={aqua} adventure={adventure} title={title} />
    );

  if (!className) return mark;
  return <span className={className}>{mark}</span>;
}

export { LOCKUP_COLORS };
