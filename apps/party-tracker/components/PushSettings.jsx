'use client';

/**
 * Notifications — the per-kind switches, on their own screen.
 *
 * They were four rows stacked under three other four-row groups in Settings →
 * Phone, which made the Phone topic a column you scroll rather than a list you
 * read. Pushed, the Phone list keeps one row saying whether notifications are
 * on at all, and the choice of *which* ones lives here where there is room for
 * each to say what it is for.
 *
 * Every string comes from `notifier.KINDS` — the same table the service worker
 * dispatches against, so a kind added there appears here without an edit.
 */
export default function PushSettings({
  pushKinds = null,
  pushPrefs = null,
  onPushPref = null,
  pushState = 'idle',
  onEnablePush = null,
  pushNeedsInstall = false,
}) {
  if (!pushKinds) return null;

  if (pushState !== 'granted') {
    return (
      <div className="pushSettings">
        <button
          type="button"
          className="btn primary rect"
          onClick={onEnablePush}
          disabled={pushNeedsInstall || pushState === 'unsupported'}
        >
          Turn on notifications
        </button>
        <p className="fine">
          {pushNeedsInstall
            ? 'On an iPhone this works once the app is on your Home Screen — “Keep the map offline”, back on Phone, does that.'
            : pushState === 'denied'
              ? 'Your phone is blocking them for this site. Turn them back on in its settings, then come back here.'
              : 'Without these, a phone in a pocket shows nothing when somebody in your party needs you.'}
        </p>
      </div>
    );
  }

  return (
    <div className="pushSettings">
      <div className="label">Tell me on this phone</div>
      <div className="rowList">
        {Object.entries(pushKinds).map(([key, spec]) => (
          <button
            key={key}
            type="button"
            className="row flat"
            onClick={() => onPushPref?.(key, !pushPrefs?.[key])}
            aria-pressed={Boolean(pushPrefs?.[key])}
          >
            <span className="rowText">
              {spec.label}
              {spec.hint ? <span className="fine">{spec.hint}</span> : null}
            </span>
            <span className={`rowValue ${pushPrefs?.[key] ? 'accent' : ''}`}>
              {pushPrefs?.[key] ? 'On' : 'Off'}
            </span>
          </button>
        ))}
      </div>
      <p className="fine">
        Turning one off never stops the others. These are per-phone — the same
        Profile on a second phone keeps its own answers.
      </p>
    </div>
  );
}
