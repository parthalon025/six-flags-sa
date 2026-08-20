'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import BrandMark from '@/components/BrandMark';
import Icon from '@/components/Icon';
import { BRAND, INTRO_CLAIMS } from '@/lib/brand';
import { pendingReleaseNotes } from '@/lib/releaseNotes';
import { APP_VERSION } from '@/lib/version';

/*
 * First run, told as a page rather than a card.
 *
 * The old splash was one bottom sheet: wordmark, one sentence, Get started.
 * Everything the app is went unsaid, and the one sentence had to carry it. This
 * scrolls instead — hero, three claims, then what a Party is — so each idea gets
 * a screen of its own and nobody has to read a paragraph to find the button.
 *
 * The footer is the whole navigation. Until the reader has been most of the way
 * down it shows how far there is left to go and offers a way out; past that it
 * becomes the one thing left to do. That way the primary action is never the
 * thing competing with the story for attention.
 */

/** Where the three progress dashes fill, as a fraction of the scroll. */
const CLAIM_MARKS = [0.22, 0.5, 0.78];

/*
 * Read enough. Not 1 — the last screenful is the footer's own gradient and a
 * version line, and demanding the absolute bottom means a phone whose momentum
 * scroll stops a pixel short never gets its button.
 */
const READ_AT = 0.82;

/*
 * Scroll fires per frame. Rounding to 2% of the page means a full swipe is
 * about fifty state updates instead of several hundred, which is the difference
 * between the dashes animating and the whole page re-rendering under the thumb.
 */
const SCROLL_STEP = 0.02;

/**
 * @param version    app version, for the tappable release-notes line
 * @param partyCode  a real party code if this phone already has one; there is
 *   normally no party yet on first run, and the panel stays off rather than
 *   showing a code that does not exist.
 */
export default function IntroSplash({ version = APP_VERSION, partyCode = null, onContinue }) {
  const [showNotes, setShowNotes] = useState(false);
  const [seen, setSeen] = useState(0);
  const [read, setRead] = useState(false);
  const scrollRef = useRef(null);
  const notes = pendingReleaseNotes(version);

  /* A short phone, a big font, or three claims that happen to fit: if there is
     nothing to scroll there is nothing left to read, and waiting for a scroll
     that cannot happen would strand Get started off the bottom of the screen. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.clientHeight <= 1) setRead(true);
  }, [showNotes]);

  const onScroll = useCallback((e) => {
    const el = e.currentTarget;
    const at = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    setSeen((prev) => (Math.abs(at - prev) > SCROLL_STEP ? at : prev));
    if (at > READ_AT) setRead(true);
  }, []);

  if (showNotes) {
    return (
      <div className="gate gateFirstRun" role="dialog" aria-labelledby="intro-notes-title">
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

  return (
    <div className="gate gateFirstRun introGate" role="dialog" aria-labelledby="intro-splash-title">
      <div className="introScroll" ref={scrollRef} onScroll={onScroll}>
        <div className="introPage">
          <header className="introHero">
            <BrandMark variant="lockup" size={44} title={BRAND.name} className="introMark" />
            <div>
              <h2 id="intro-splash-title" className="introWordmark">
                {BRAND.nameUpper}
              </h2>
              <p className="introSlogan">{BRAND.slogan}</p>
            </div>
            <p className="introPitch">{BRAND.introPitch}</p>
            <p className="introNudge" aria-hidden="true">
              <Icon name="arrow.down" size={15} className="icn introNudgeArrow" />
              <span>SCROLL</span>
            </p>
          </header>

          {INTRO_CLAIMS.map((claim) => (
            <section key={claim.num} className="introClaim">
              <span className="introClaimNum">{claim.num}</span>
              <h3 className="introClaimTitle">{claim.title}</h3>
              <p className="introClaimCopy">{claim.copy}</p>
            </section>
          ))}

          <section className="introInvite">
            <div className="gateEyebrow introInviteEyebrow">Invite your Party</div>
            <p className="introInviteCopy">
              One link. Everyone joins from their own phone and adds their height.
            </p>
            {partyCode ? (
              <div className="codeBox introInviteCode">
                <span className="codeText">{partyCode}</span>
              </div>
            ) : null}
          </section>
        </div>

        <div className="introFoot">
          {read ? (
            <button type="button" className="btn primary rect introStart" onClick={onContinue}>
              Get started
            </button>
          ) : (
            <div className="introFootRow">
              <div className="introDots" aria-hidden="true">
                {CLAIM_MARKS.map((at) => (
                  <span key={at} className={seen >= at ? 'introDot on' : 'introDot'} />
                ))}
              </div>
              <span className="introFootHint">Keep scrolling</span>
              <button type="button" className="btn small rect introSkip" onClick={onContinue}>
                Skip intro
              </button>
            </div>
          )}
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
    </div>
  );
}
