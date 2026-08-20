'use client';

import Icon from '@/components/Icon';
import { softGateBlocks } from '@/lib/auth/session';
import {
  SKINS,
  SKIN_IDS,
  KITS,
  KIT_ICONS,
  MARK_TYPES,
  MARK_ICONS,
  SIGN_PHRASES,
  skinRung,
  skinAllowedAt,
} from '@/lib/world';

/**
 * Collection: Skins (unlock / share / Offer / Wear), Kits, Marks at this Place.
 * Trail / Park Midnight stay the Light/Dark chrome above this list.
 */
export default function WorldCloset({
  progress,
  world = null,
  acceptedOffer = null,
  selfId = null,
  session = null,
  venue = null,
  position = null,
  now = Date.now(),
  onWearOwn = null,
  onAcceptOffer = null,
  onClearWear = null,
  onOffer = null,
  onWithdraw = null,
  onEquipKit = null,
  onDropMark = null,
  /** The patch of ground a Mark is being anchored to — `lib/spot.js`, set by
   *  tapping "Leave a Mark" on the map's spot capsule, null when the visitor
   *  arrived here through Settings. Nothing below reads it yet: the anchored
   *  gate (Sign/Beacon reading "Pick a spot" until there is one, and the
   *  placeable set narrowing to those two — D17) is the Marks pass's work.
   *  Declared here so the wire from the map exists and is one prop, not five. */
  spot = null,
  onClearSpot = null,
}) {
  const needsProfile = softGateBlocks('world', session);
  const offers = world?.offers || [];
  const kit = progress?.kit || null;

  return (
    <div className="worldCloset">
      <div className="label">Collection</div>
      <p className="fine">
        Skins paint this map. Kits are how your Party sees you. Marks stay at a Place for
        families you never meet. Light and Dark above are chrome, not Skins.
      </p>

      {offers.length > 0 && (
        <>
          <div className="label">Offers in this Party</div>
          <div className="rowList">
            {offers.map((o) => {
              const skin = SKINS[o.skinId];
              const wearing =
                acceptedOffer?.fromMemberId === o.fromMemberId && acceptedOffer?.skinId === o.skinId;
              return (
                <button
                  key={`${o.fromMemberId}:${o.skinId}`}
                  type="button"
                  className="row"
                  onClick={() => (wearing ? onClearWear?.() : onAcceptOffer?.(o))}
                >
                  <span className="rowText">
                    {skin?.label || o.skinId}
                    <span className="fine"> — offered by a Member</span>
                  </span>
                  <span className="rowValue">{wearing ? 'Wearing · tap to stop' : 'Wear'}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="label">Skins</div>
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
          return (
            <div key={id} className="worldSkinRow">
              <button
                type="button"
                className={`row ${wearingOwn ? 'on' : ''}`}
                disabled={!rung || !allowed}
                onClick={() => rung && allowed && onWearOwn?.(id)}
              >
                <span className="rowText">{skin.label}</span>
                <span className="rowValue">{wearingOwn ? 'Wearing' : value}</span>
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

      <div className="label">Kits</div>
      <p className="fine">Your Party sees this on your puck. Strangers never do. There is no Offer for Kits.</p>
      <div className="rowList">
        {Object.values(KITS).map((k) => (
          <button
            key={k.id}
            type="button"
            className={`row ${kit === k.id ? 'on' : ''}`}
            disabled={needsProfile}
            onClick={() => onEquipKit?.(kit === k.id ? null : k.id)}
          >
            <span className="rowText">
              <Icon name={KIT_ICONS[k.id] || 'location.fill'} size={18} /> {k.label}
            </span>
            <span className="rowValue">{kit === k.id ? 'Equipped' : needsProfile ? 'Sign in' : 'Equip'}</span>
          </button>
        ))}
      </div>

      <div className="label">Leave a Mark</div>
      <p className="fine">
        Signs use a closed phrase list. Party sees it now; other guests after a second Party Thanks.
      </p>
      {needsProfile ? (
        <p className="fine">Sign in to leave a Mark.</p>
      ) : (
        <div className="chips wrap">
          {MARK_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="chip"
              disabled={!position}
              onClick={() => {
                if (type === 'sign') {
                  onDropMark?.({ type, phrase: SIGN_PHRASES[0], lat: position?.lat, lng: position?.lng });
                  return;
                }
                onDropMark?.({ type, lat: position?.lat, lng: position?.lng });
              }}
            >
              <Icon name={MARK_ICONS[type] || 'mappin.and.ellipse'} size={14} /> {type}
            </button>
          ))}
        </div>
      )}
      {!needsProfile && (
        <div className="chips wrap" style={{ marginTop: 8 }}>
          {SIGN_PHRASES.map((phrase) => (
            <button
              key={phrase}
              type="button"
              className="chip"
              disabled={!position}
              onClick={() => onDropMark?.({ type: 'sign', phrase, lat: position?.lat, lng: position?.lng })}
            >
              {phrase}
            </button>
          ))}
        </div>
      )}
      {!position && !needsProfile && <p className="fine">Stand somewhere on the map to drop a Mark.</p>}
    </div>
  );
}
