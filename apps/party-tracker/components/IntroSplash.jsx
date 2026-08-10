'use client';

import { useState } from 'react';
import BrandLockup from '@/components/BrandLockup';
import { BRAND } from '@/lib/brand';
import { allReleaseNotes } from '@/lib/releaseNotes';
import { APP_VERSION } from '@/lib/version';

/**
 * First-run intro splash — brand, slogan, one-line pitch, and a tappable version.
 * GPS and park intake live on the next screen (GpsGate).
 */
export default function IntroSplash({ version = APP_VERSION, onContinue }) {
  const [showNotes, setShowNotes] = useState(false);
  const notes = allReleaseNotes(version);

  if (showNotes) {
    return (
      <div className="gate" role="dialog" aria-labelledby="intro-notes-title">
        <div className="gateCard">
          <div className="gateEyebrow">{BRAND.nameUpper}</div>
          <h2 id="intro-notes-title">Updates</h2>
          {notes.length > 0 ? (
            notes.map((block) => (
              <section key={block.version} className="updateNotesBlock">
                <p className="fine updateNotesVersion">Version {block.version}</p>
                <div className="introList">
                  {block.items.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <p>You are on version {version}. Release notes will appear here after future updates.</p>
          )}
          <button type="button" className="btn primary" onClick={() => setShowNotes(false)}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gate" role="dialog" aria-labelledby="intro-splash-title">
      <div className="gateCard introSplashCard">
        <div className="gateEyebrow">Welcome</div>
        <BrandLockup
          size="lg"
          stacked
          showTagline
          className="gateBrandLockup"
          markTitle={BRAND.name}
          nameId="intro-splash-title"
        />
        <p>{BRAND.shortDescription}</p>
        <button type="button" className="btn primary" onClick={onContinue}>
          Get started
        </button>
        <button
          type="button"
          className="gateVersionBtn"
          onClick={() => setShowNotes(true)}
          aria-label={`Version ${version}. Tap to see updates.`}
        >
          Version {version}
        </button>
      </div>
    </div>
  );
}
