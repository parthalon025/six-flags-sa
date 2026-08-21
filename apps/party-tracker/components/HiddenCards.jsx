'use client';

/**
 * What the panel shows — the cards this phone hid, per park.
 *
 * Once the undo for a one-way gesture. The gesture is gone: the glance rail
 * was the only thing that ever wrote to `hiddenCards`, and Explore is search →
 * context → list now. So this list can only ever shrink, and it exists so a
 * phone still carrying hides from before that change has a way to clear them.
 *
 * Which means the copy has to stop describing the ✕ it used to describe.
 * Telling a first-time visitor to swipe a card that cannot exist is worse than
 * saying nothing — it sends her looking for an app she does not have. The text
 * below says what is true of the phone reading it, and nothing else.
 */
export default function HiddenCards({ hiddenCards = null, cardLabels = null, onUnhideCard = null }) {
  return (
    <div className="hiddenCards">
      <div className="label">Hidden on this park</div>
      <div className="rowList">
        {hiddenCards?.length ? (
          hiddenCards.map((key) => (
            <button key={key} type="button" className="row flat" onClick={() => onUnhideCard?.(key)}>
              <span className="rowText">{cardLabels?.[key] || key}</span>
              <span className="rowValue">Hidden · tap to show</span>
            </button>
          ))
        ) : (
          <div className="row flat">
            <span className="rowText">Nothing hidden</span>
            <span className="rowValue">All cards showing</span>
          </div>
        )}
      </div>
      <p className="fine">
        {hiddenCards?.length
          ? 'These were hidden by an older version of the Explore panel. Tap one to show it again. Each park remembers its own.'
          : 'Nothing on the Explore panel hides itself any more, so this stays empty. It is here to clear anything an older version of the app put in it.'}
      </p>
    </div>
  );
}
