'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import BrandMark from '@/components/BrandMark';
import Icon from '@/components/Icon';
import { BRAND, INTRO_CLAIMS } from '@/lib/brand';
import { introDotThresholds, introReadFraction } from '@/lib/introGate';
import { pendingReleaseNotes } from '@/lib/releaseNotes';
import { APP_VERSION } from '@/lib/version';

const DOT_THRESHOLDS = introDotThresholds(INTRO_CLAIMS.length);
const READ_FRACTION = introReadFraction(INTRO_CLAIMS.length);

/**
 * How far down `el` has been scrolled, 0..1. A container with no scroll room
 * — a short intro on a tall phone, a guest zoomed in, or reduced content —
 * reads as fully read: there is nothing further scrolling could reveal, so
 * the footer must not sit stuck on "Skip intro" with no way to clear it.
 */
function readFractionFor(el) {
  if (!el) return 0;
  const scrollable = el.scrollHeight - el.clientHeight;
  if (scrollable <= 0) return 1;
  return Math.max(0, Math.min(1, el.scrollTop / scrollable));
}

/**
 * First-run onboarding — a scroll story, not a tap-to-continue card: brand,
 * three claims (`INTRO_CLAIMS`), the Party pitch, then a sticky footer that
 * tracks how much of it the guest has read and swaps "Skip intro" for "Get
 * started" once they have. The version line still opens release notes in
 * place, exactly as it did on the old splash.
 */
export default function IntroSplash({ version = APP_VERSION, onContinue }) {
  const [showNotes, setShowNotes] = useState(false);
  const notes = pendingReleaseNotes(version);

  const scrollRef = useRef(null);
  const [readFraction, setReadFraction] = useState(0);

  const measure = useCallback(() => {
    const next = readFractionFor(scrollRef.current);
    setReadFraction((prev) => (Math.abs(next - prev) > 0.02 || next === 0 || next === 1 ? next : prev));
  }, []);

  // Measure on mount (and on resize/rotate) as well as on scroll: a short
  // viewport may already have no scroll room before the guest touches it.
  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  if (showNotes) {
    return (
      // Keyed distinctly from the story view below: both return a bare `div`
      // at the same position, and without a key React patches one gate into
      // the other in place rather than unmounting it — carrying the scroll
      // story's DOM (and its scrollTop) into what should be a fresh subtree.
      <div key="notes" className="gate gateFirstRun" role="dialog" aria-labelledby="intro-notes-title">
        <div className="gateCard">
          <div className="gateEyebrow">{BRAND.nameUpper}</div>
          <h2 id="intro-notes-title">What&apos;s new</h2>
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
          <button type="button" className="btn primary rect" onClick={() => setShowNotes(false)}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const introRead = readFraction > READ_FRACTION;

  return (
    <div key="story" className="gate gateFirstRun introGate" role="dialog" aria-labelledby="intro-splash-title">
      <div
        ref={scrollRef}
        className="introScroll"
        onScroll={measure}
        tabIndex={0}
        aria-label={`${BRAND.name} introduction`}
      >
        <div className="introPage">
          <div className="introHero">
            <BrandMark variant="lockup" size={44} title={BRAND.name} className="introMark" />
            <div>
              <h1 id="intro-splash-title" className="introWordmark">
                {BRAND.nameUpper}
              </h1>
              <p className="introSlogan">{BRAND.slogan}</p>
            </div>
            <p className="introPitch">{BRAND.introPitch}</p>
            <div className="introNudge" aria-hidden="true">
              <Icon name="arrow.down" size={15} className="introNudgeArrow" />
              <span>SCROLL</span>
            </div>
          </div>

          {INTRO_CLAIMS.map((claim) => (
            <div className="introClaim" key={claim.num}>
              <span className="introClaimNum">{claim.num}</span>
              <h2 className="introClaimTitle">{claim.title}</h2>
              <p className="introClaimCopy">{claim.copy}</p>
            </div>
          ))}

          {/* What a Party is, said before this guest has one. No code or QR
              here — those only exist once a Party has actually been created,
              which nothing before this screen has done; the pitch stands on
              its own and the footer below is the one way onward. */}
          <div className="introInvite">
            <span className="gateEyebrow introInviteEyebrow">Invite your party</span>
            <p className="introInviteCopy">
              One link. Everyone joins from their own phone and adds their height.
            </p>
          </div>
        </div>

        <div className="introFoot">
          <div className="introFootRow">
            {!introRead && (
              <>
                <div className="introDots" aria-hidden="true">
                  {DOT_THRESHOLDS.map((at, i) => (
                    <span key={i} className={`introDot${readFraction >= at ? ' on' : ''}`} />
                  ))}
                </div>
                <span className="introFootHint">Keep scrolling</span>
              </>
            )}
            <button
              type="button"
              className={introRead ? 'introStart' : 'introSkip'}
              onClick={onContinue}
              aria-live="polite"
              aria-atomic="true"
            >
              {introRead ? 'Get started' : 'Skip intro'}
            </button>
          </div>
          <button
            type="button"
            className="gateVersionBtn"
            onClick={(e) => {
              e.stopPropagation();
              setShowNotes(true);
            }}
            aria-label={`Version ${version}. Tap to see updates.`}
          >
            Version {version}
          </button>
        </div>
      </div>
    </div>
  );
}
