'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import BrandMark from '@/components/BrandMark';
import Icon from '@/components/Icon';
import { BRAND, INTRO_CLAIMS } from '@/lib/brand';
import { pendingReleaseNotes } from '@/lib/releaseNotes';
import { APP_VERSION } from '@/lib/version';

/**
 * How far down `scroller` has been scrolled, 0..1. A container with no
 * scroll room — a short intro on a tall phone, a guest zoomed in, or
 * reduced content — reads as fully read: there is nothing further
 * scrolling could reveal, so the footer must not sit stuck on "Skip
 * intro" with no way to clear it.
 */
function scrollFraction(scroller) {
  if (!scroller) return 0;
  const scrollable = scroller.scrollHeight - scroller.clientHeight;
  if (scrollable <= 0) return 1;
  return Math.max(0, Math.min(1, scroller.scrollTop / scrollable));
}

/**
 * The scroll fraction at which content-relative position `offset` sits in
 * the centre of `scroller`'s viewport.
 */
function fractionForOffset(offset, scroller, scrollable) {
  if (scrollable <= 0) return 0;
  const target = offset - scroller.clientHeight / 2;
  return Math.max(0, Math.min(1, target / scrollable));
}

/**
 * `el`'s position within `scroller`'s total (unscrolled) content, measured
 * from real layout (`getBoundingClientRect`), which sees what a claim count
 * cannot: the hero's actual height, how the copy wrapped, and the viewport
 * size. `elRect.top` already carries the current scroll offset; adding
 * `scroller.scrollTop` removes it again, leaving a position that reads the
 * same no matter where the scroller happened to be when this ran.
 */
function contentRectOf(el, scroller) {
  const scrollerTop = scroller.getBoundingClientRect().top;
  const elRect = el.getBoundingClientRect();
  return { top: elRect.top - scrollerTop + scroller.scrollTop, height: elRect.height };
}

/** The scroll fraction at which `el`'s centre reaches the viewport centre — "the reader is looking at this element right now." Drives the progress dots, one call per claim. */
function centerFraction(el, scroller, scrollable) {
  if (!el || !scroller || scrollable <= 0) return 0;
  const { top, height } = contentRectOf(el, scroller);
  return fractionForOffset(top + height / 2, scroller, scrollable);
}

/**
 * Extra scroll, on top of the last claim's own dot, before the footer
 * offers "Get started" — enough that the flip reads as "just after" the
 * last dot rather than the same instant, small enough to still feel
 * prompt. A pixel amount rather than a fraction of the range: a fixed
 * fraction shrinks to nothing on a story this short and swells on a much
 * longer one, where a fixed screen distance stays the same felt gap
 * either way. 20px is not derived from anything; it is picked to read,
 * on an ordinary phone, about like the design's own 0.78 -> 0.82 gap.
 */
const READ_MARGIN_PX = 20;

/**
 * However close the last claim's own centre-fraction already sits to 1,
 * the read threshold is never allowed past this — a fully scrolled guest
 * (`scrollFraction` reaching exactly 1) must always end up strictly past
 * the threshold, on every viewport, including one so short that centring
 * the last claim already needs nearly all the scroll room there is. Purely
 * a reachability floor, not a design number: it only ever binds in that
 * degenerate case, where it leaves a sliver of scroll rather than none.
 */
const READ_THRESHOLD_CEILING = 0.99;

/**
 * The read threshold: the last claim's own centre-fraction (the same
 * measurement that lights its dot) plus {@link READ_MARGIN_PX} converted to
 * a fraction of this scroller's actual range, capped at
 * {@link READ_THRESHOLD_CEILING}.
 */
function readThresholdFor(lastClaimCenter, scrollable) {
  const withMargin = lastClaimCenter + READ_MARGIN_PX / scrollable;
  return Math.min(withMargin, READ_THRESHOLD_CEILING);
}

/**
 * First-run onboarding. Switches between the scroll story and the
 * release-notes reader — two distinct components, not two branches of one
 * function returning the same `div` shape: React tells components apart
 * by type and unmounts one before mounting the other on its own, so
 * neither has to inherit the other's leftover DOM (a scroll position, a
 * focused element).
 */
export default function IntroSplash({ version = APP_VERSION, onContinue }) {
  const [showNotes, setShowNotes] = useState(false);
  return showNotes ? (
    <IntroReleaseNotes version={version} onBack={() => setShowNotes(false)} />
  ) : (
    <IntroStory version={version} onContinue={onContinue} onOpenNotes={() => setShowNotes(true)} />
  );
}

/** The sub-view behind the version line — unchanged from the old splash. */
function IntroReleaseNotes({ version, onBack }) {
  const notes = pendingReleaseNotes(version);
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
        <button type="button" className="btn primary rect" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

/**
 * The scroll story: brand, the three `INTRO_CLAIMS`, the Party pitch, then a
 * sticky footer that tracks how much of it the guest has read and swaps
 * "Skip intro" for "Get started" once they have.
 *
 * "Read" is measured from real layout, not counted: on mount, on resize, and
 * whenever the story's own height changes (a font swap re-wrapping copy),
 * each claim's centre-of-viewport scroll fraction is remeasured directly
 * off the DOM (`centerFraction`) for the dots, and the footer flips a small
 * fixed distance past the *last* claim's own dot (`readThresholdFor`) —
 * close enough behind it to read as "right after", never at the same
 * instant, and never past the point a full scroll can actually reach.
 */
function IntroStory({ version, onContinue, onOpenNotes }) {
  const scrollRef = useRef(null);
  const pageRef = useRef(null);
  // INTRO_CLAIMS is a static, module-level list — the same claims in the
  // same order every render — so each index's ref callback can just assign
  // in place with no reset-then-repopulate dance (which would mean writing
  // to the ref during render, not just in the callback React invokes after
  // committing the DOM).
  const claimRefs = useRef([]);

  const [readFraction, setReadFraction] = useState(0);
  const [dotThresholds, setDotThresholds] = useState(() => INTRO_CLAIMS.map(() => 1));
  const [readThreshold, setReadThreshold] = useState(1);

  // No hysteresis here: a claim near either end of the story can have a
  // measured threshold close to 0 or 1, and a guard against small deltas
  // (the previous version required a jump of more than 0.02) silently ate
  // exactly those crossings — a slow scroll, or a single instant jump from
  // a keyboard Home/End, could land inside the dead zone and never register.
  // A plain state set costs a comparison and a possible re-render of three
  // dots; nothing here is expensive enough to need throttling.
  const measure = useCallback(() => {
    setReadFraction(scrollFraction(scrollRef.current));
  }, []);

  const measureThresholds = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const scrollable = scroller.scrollHeight - scroller.clientHeight;
    if (scrollable <= 0) {
      // Nothing to scroll: every claim is already on screen at once, so
      // there is no "reader is looking at claim N" moment to measure —
      // treat the whole story as already read (scrollFraction agrees,
      // returning 1 in this same case) rather than leaving the dots stuck
      // dark and Skip intro with no scroll gesture that could clear it.
      setDotThresholds(INTRO_CLAIMS.map(() => 0));
      setReadThreshold(0);
      return;
    }
    const claims = claimRefs.current;
    const dots = claims.map((el) => centerFraction(el, scroller, scrollable));
    setDotThresholds(dots);
    setReadThreshold(readThresholdFor(dots[dots.length - 1], scrollable));
  }, []);

  useLayoutEffect(() => {
    const remeasure = () => {
      measureThresholds();
      measure();
    };
    remeasure();

    window.addEventListener('resize', remeasure);

    // A font swap changes wrapped-copy height without a window resize —
    // watch the content wrapper itself so any reflow of the story (a late
    // font, a dynamic-type setting) re-measures where each claim actually
    // sits, not just where it sat at mount.
    let observer;
    if (typeof ResizeObserver !== 'undefined' && pageRef.current) {
      observer = new ResizeObserver(remeasure);
      observer.observe(pageRef.current);
    }
    document.fonts?.ready?.then(remeasure).catch(() => {});

    return () => {
      window.removeEventListener('resize', remeasure);
      observer?.disconnect();
    };
  }, [measure, measureThresholds]);

  const introRead = readFraction > readThreshold;

  return (
    <div className="gate gateFirstRun introGate" role="dialog" aria-labelledby="intro-splash-title">
      <div
        ref={scrollRef}
        className="introScroll"
        onScroll={measure}
        tabIndex={0}
        aria-label={`${BRAND.name} introduction`}
      >
        <div className="introPage" ref={pageRef}>
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

          {INTRO_CLAIMS.map((claim, i) => (
            <div
              className="introClaim"
              key={claim.num}
              ref={(el) => {
                claimRefs.current[i] = el;
              }}
            >
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
                  {dotThresholds.map((at, i) => (
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
              onOpenNotes();
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
