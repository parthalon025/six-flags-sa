'use client';

import Icon from '@/components/Icon';

/**
 * "You came here from a patch of ground" — the anchored spot, inside a screen.
 *
 * `SpotCapsule` asks the question over the map; this is the answer's receipt,
 * at the top of whichever screen the visitor chose. It is the same object
 * (`lib/spot.js`) said in one line instead of four, because by now the pin is
 * off screen and all that is left to carry is where "here" was.
 *
 * The ✕ is not decoration. An anchor changes what the screen behind it does —
 * Marks will not place without one, Side Quests sorts by it — so the way out
 * of that mode has to be visible on the thing that put you in it.
 */
export default function SpotBanner({ spot, onClear = null, label = null }) {
  if (!spot) return null;
  const line = [spot.name, spot.zone].filter(Boolean).join(' · ');
  return (
    <div className="spotBanner" role="group" aria-label={label || 'Anchored spot'}>
      <span className="spotBannerGlyph" aria-hidden="true">
        <Icon name="mappin.and.ellipse" size={17} />
      </span>
      <span className="spotBannerText">
        <b>{line}</b>
        {/* `reach` is null with no fix — the row keeps its one line rather
            than printing an em dash where a walk time would be. */}
        {spot.reach ? <span>{spot.reach}</span> : null}
      </span>
      {onClear ? (
        <button type="button" className="spotBannerClear" onClick={onClear} aria-label="Clear this spot">
          <Icon name="xmark" size={15} />
        </button>
      ) : null}
    </div>
  );
}
