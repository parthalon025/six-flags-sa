'use client';

import { BRAND } from '@/lib/brand';
import BrandMark from '@/components/BrandMark';

/**
 * Primary logo lockup — Modern Waypoint + PARKBOUND wordmark + tagline.
 *
 * Use for: desktop/main header, splash/welcome screen, marketing collateral.
 * Do not use the full lockup for the home-screen icon, notifications, or map
 * pins — those take BrandMark variant="glyph".
 *
 * @param {'sm' | 'md' | 'lg'} [size]
 * @param {boolean} [showTagline]
 * @param {boolean} [stacked] wordmark under the mark (splash) vs beside it
 */
export default function BrandLockup({
  size = 'md',
  showTagline = true,
  stacked = false,
  className = '',
  markTitle,
}) {
  const markPx = size === 'lg' ? 56 : size === 'sm' ? 28 : 40;
  const NameTag = size === 'lg' ? 'h2' : 'span';

  return (
    <div
      className={`brandLockup ${stacked ? 'stacked' : ''} ${className}`.trim()}
      data-size={size}
    >
      <BrandMark variant="lockup" size={markPx} title={markTitle} className="brandLockupMark" />
      <div className="brandLockupText">
        <NameTag className="brandLockupName">{BRAND.nameUpper}</NameTag>
        {showTagline ? (
          <span className="brandLockupTagline">{BRAND.slogan}</span>
        ) : null}
      </div>
    </div>
  );
}
