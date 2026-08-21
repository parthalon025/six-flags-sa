'use client';

import Icon from '@/components/Icon';
import { softGateBlocks } from '@/lib/auth/session';
import {
  SKINS,
  SKIN_IDS,
  KITS,
  KIT_ICONS,
  mapPaint,
  skinRung,
  skinAllowedAt,
} from '@/lib/world';

/**
 * Collection — Skins, Kits, and the way through to Marks.
 *
 * Skins and Kits are catalogue: a list of things you have or have not earned,
 * read in one pass. Marks are a *place* you do something, so they sit behind a
 * row rather than inside this one (components/WorldMarks.jsx). Trail and Park
 * Midnight stay chrome above all of it, in Settings → Map, and are not Skins.
 */
export default function WorldCloset({
  progress,
  world = null,
  acceptedOffer = null,
  selfId = null,
  session = null,
  venue = null,
  now = Date.now(),
  onWearOwn = null,
  onAcceptOffer = null,
  onClearWear = null,
  onOffer = null,
  onWithdraw = null,
  onEquipKit = null,
  onOpenMarks = null,
  /** The anchored patch of ground, when the visitor arrived through the map's
   *  "Leave a Mark". Read for one thing only — telling the Marks row what it
   *  is about to open onto. Placement itself lives on that screen. */
  spot = null,
}) {
  const needsProfile = softGateBlocks('world', session);
  const offers = world?.offers || [];
  const kit = progress?.kit || null;

  /* What the Marks row is standing over. "By The Beast" → "by The Beast" so it
     reads as a sentence; open ground has no name of its own and takes the Zone
     instead — the same two phrasings WorldMarks uses for its own foot line. */
  const marksSub = spot
    ? spot.name.startsWith('By ')
      ? `Anchored ${spot.name.replace(/^By /, 'by ')}`
      : `Anchored in ${spot.zone}`
    : 'Signs and beacons you place';

  return (
    <div className="worldCloset">
      <p className="fine">
        Skins paint this map. Kits are how your Party sees you. Marks stay at a Place for
        families you never meet. Light and Dark are chrome, not Skins.
      </p>

      {offers.length > 0 && (
        <>
          <div className="label eyebrow">Offers in this Party</div>
          <div className="rowList">
            {offers.map((o) => {
              const skin = SKINS[o.skinId];
              const wearing =
                acceptedOffer?.fromMemberId === o.fromMemberId && acceptedOffer?.skinId === o.skinId;
              return (
                <button
                  key={`${o.fromMemberId}:${o.skinId}`}
                  type="button"
                  className="row flat"
                  onClick={() => (wearing ? onClearWear?.() : onAcceptOffer?.(o))}
                >
                  <span className="rowText">
                    {skin?.label || o.skinId}
                    <span className="fine"> — offered by a Member</span>
                  </span>
                  <span className={`rowValue ${wearing ? 'accent' : ''}`}>
                    {wearing ? 'Wearing · tap to stop' : 'Wear'}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="label eyebrow">Skins</div>
      {needsProfile && (
        <p className="fine">Sign in to unlock, share, and Offer. You can still Wear an Offer by name.</p>
      )}
      <div className="rowList">
        {SKIN_IDS.map((id) => {
          const skin = SKINS[id];
          const allowed = skinAllowedAt({ skinId: id, venue, now });
          const rung = skinRung(progress, id, venue?.id);
          const offering = offers.some((o) => o.fromMemberId === selfId && o.skinId === id);
          const wearingOwn = progress?.wearSkin === id && !acceptedOffer;
          let value = 'Locked';
          if (!allowed) value = skin.season ? 'Out of season' : 'This World';
          else if (rung === 'share') value = offering ? 'Offering' : 'Share earned';
          else if (rung === 'unlock') value = 'Unlocked';
          /* The swatch is the paint, not a picture of it. `SKINS[].paint` is
             the same object mapThemeCssVars and applyMapSkin hand the map, so
             a two-colour chip read off it can never drift from what tapping
             the row actually does to the ground under your thumb. */
          const paint = mapPaint(id);
          return (
            <div key={id} className="worldSkinRow">
              <button
                type="button"
                className={`row flat ${wearingOwn ? 'on' : ''}`}
                disabled={!rung || !allowed}
                onClick={() => rung && allowed && onWearOwn?.(id)}
              >
                <span
                  className="skinSwatch"
                  aria-hidden="true"
                  style={{ background: paint.ground, borderColor: paint.path.stroke }}
                />
                <span className="rowText">{skin.label}</span>
                <span className={`rowValue ${wearingOwn ? 'accent' : ''}`}>
                  {wearingOwn ? 'Wearing' : value}
                </span>
              </button>
              {rung === 'share' && allowed && !needsProfile && (
                <div className="worldSkinActions">
                  {offering ? (
                    <button type="button" className="chip" onClick={() => onWithdraw?.(id)}>
                      Withdraw Offer
                    </button>
                  ) : (
                    <button type="button" className="chip" onClick={() => onOffer?.(id)}>
                      Offer to Party
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="label eyebrow">Kits</div>
      <p className="fine">
        Your Party sees this on your puck. Strangers never do — kitForViewer returns nothing
        outside the Party — and there is no Offer for Kits.
      </p>
      <div className="rowList">
        {Object.values(KITS).map((k) => (
          <button
            key={k.id}
            type="button"
            className={`row flat ${kit === k.id ? 'on' : ''}`}
            disabled={needsProfile}
            onClick={() => onEquipKit?.(kit === k.id ? null : k.id)}
          >
            <span className={`kitGlyph ${kit === k.id ? 'on' : ''}`} aria-hidden="true">
              <Icon name={KIT_ICONS[k.id] || 'location.fill'} size={18} />
            </span>
            <span className="rowText">{k.label}</span>
            <span className={`rowValue ${kit === k.id ? 'accent' : ''}`}>
              {kit === k.id ? 'Equipped' : needsProfile ? 'Sign in' : 'Equip'}
            </span>
          </button>
        ))}
      </div>

      <div className="label eyebrow">Marks</div>
      <div className="rowList">
        <button type="button" className="row" onClick={() => onOpenMarks?.()}>
          <span className="markGlyph accent" aria-hidden="true">
            <Icon name="mappin.and.ellipse" size={18} />
          </span>
          <span className="rowText">
            Marks
            <span className="fine">{marksSub}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
