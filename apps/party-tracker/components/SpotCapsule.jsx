'use client';

import Icon from '@/components/Icon';

/**
 * The card that answers a tap on bare ground.
 *
 * It says where the tap landed in the same three lines every Place gets — a
 * name, the Zone and the nearest thing with a name, and the walk — and then
 * offers the only two things a person can do with a patch of ground: file a
 * Side Quest about it, or leave a Mark on it. Both carry the spot forward, so
 * the screen that opens next already knows where "here" is.
 *
 * It floats over the map rather than living in the sheet: the whole point of
 * the interaction is that you are looking at the place you tapped, and a card
 * that pulls the sheet up over it would hide the pin it is describing. It
 * rides `--sheetFoot`, the sheet's top edge, so it moves with the sheet drag
 * exactly as the FABs and the scale bar do.
 *
 * The spot itself is `lib/spot.js` — this component formats it and nothing
 * more, which is why every string below is read straight off the object.
 */
export default function SpotCapsule({ spot, onClose = null, onQuest = null, onMark = null }) {
  if (!spot) return null;

  // `near` is null only at a venue with no Places at all, and `reach` is null
  // whenever there is no fix — denied, indoors, or waiting on the first one.
  // Both lines are dropped rather than filled with an em dash: a spot that
  // cannot say how far away it is should not draw a row saying so.
  const context = [spot.zone, spot.near].filter(Boolean).join(' · ');

  return (
    <div className="spotCapsule" role="group" aria-label={spot.name}>
      <div className="spotCapsuleHead">
        <span className="spotText">
          <b className="spotName">{spot.name}</b>
          {context ? <span className="spotZone">{context}</span> : null}
          {spot.reach ? <span className="spotReach">{spot.reach}</span> : null}
        </span>
        <button type="button" className="spotClose" onClick={() => onClose?.()} aria-label="Close">
          <Icon name="xmark.circle.fill" size={20} />
        </button>
      </div>
      <div className="spotActions">
        <button
          type="button"
          className="btn small rect primary spotAction"
          onClick={() => onQuest?.(spot)}
        >
          <Icon name="flag.fill" size={15} />
          Side Quest here
        </button>
        <button
          type="button"
          className="btn small rect spotAction spotActionOutline"
          onClick={() => onMark?.(spot)}
        >
          <Icon name="mappin.and.ellipse" size={15} />
          Leave a Mark
        </button>
      </div>
    </div>
  );
}
