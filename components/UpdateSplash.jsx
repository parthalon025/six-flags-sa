'use client';

/**
 * Startup splash for release notes after an update. Uses the same gate chrome as
 * the location intake so it feels like part of the same first-run experience.
 */

export default function UpdateSplash({ notes, onContinue }) {
  if (!notes?.length) return null;

  return (
    <div className="gate" role="dialog" aria-labelledby="update-splash-title">
      <div className="gateCard">
        <div className="gateEyebrow">Updated</div>
        <h2 id="update-splash-title">
          {notes.length === 1 ? notes[0].title : "What's new"}
        </h2>
        {notes.map((block) => (
          <section key={block.version} className="updateNotesBlock">
            {notes.length > 1 ? (
              <p className="fine updateNotesVersion">Version {block.version}</p>
            ) : null}
            <div className="introList">
              {block.items.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </section>
        ))}
        <button type="button" className="btn primary" onClick={onContinue}>
          Continue
        </button>
        <p className="gateFine">
          You will only see this once. Tap Continue and let&apos;s ride.
        </p>
      </div>
    </div>
  );
}
