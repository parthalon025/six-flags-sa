'use client';

/**
 * What the panel shows — the cards this phone has swiped away, per park.
 *
 * The undo for a gesture that is otherwise one-way. Pushed rather than stacked
 * into Settings → Phone because it is empty most of the time, and an empty
 * four-row group in the middle of a list is worse than a row that says how
 * many there are.
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
        Swipe a card up on the Explore panel, or tap its ✕, to get rid of it. Anything you remove
        is listed here for this park, and each park remembers its own.
      </p>
    </div>
  );
}
