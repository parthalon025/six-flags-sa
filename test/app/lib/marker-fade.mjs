/**
 * POI-marker fade-in checks, run inside the browser via `page.evaluate`.
 *
 * Playwright serializes an `evaluate` callback by its own source text — the
 * function crosses into the page, nothing it closes over does. So every
 * export here is self-contained: whatever it needs (a keyframe reader, a
 * MutationObserver) is declared inside the function body rather than shared
 * between exports, the same way `map-decisions.mjs` is a library because the
 * same check has to run in two different places.
 *
 * Interface:
 *   checkMarkerFade(selectors)  -> per-selector animation facts, read off
 *                                  computed style and the stylesheet's own
 *                                  keyframes rather than the source text, so
 *                                  a rule that is deleted, renamed, or
 *                                  quietly re-pointed at something that does
 *                                  not fade is caught.
 *   startFadeWatch(selector)    -> arms a MutationObserver on `document.body`
 *                                  that records `getComputedStyle(node).opacity`
 *                                  for every matching node the instant it is
 *                                  inserted — the one moment a poll usually
 *                                  misses. Safe to call again without a prior
 *                                  stopFadeWatch: it disconnects whatever it
 *                                  finds armed first.
 *   stopFadeWatch()             -> disconnects that observer and returns the
 *                                  opacities it recorded, oldest first.
 */

export function checkMarkerFade(selectors) {
  const startsTransparent = (name) => {
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules || []) {
        if (rule.type !== CSSRule.KEYFRAMES_RULE || rule.name !== name) continue;
        for (const frame of rule.cssRules) {
          const from = frame.keyText === '0%' || frame.keyText === 'from';
          if (from) return Number(frame.style.opacity) === 0;
        }
      }
    }
    return false;
  };
  const read = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return { selector, found: false };
    const css = getComputedStyle(el);
    const name = css.animationName;
    return {
      selector,
      found: true,
      name,
      seconds: parseFloat(css.animationDuration) || 0,
      fades: Boolean(name) && name !== 'none' && startsTransparent(name),
    };
  };
  return selectors.map(read);
}

export function startFadeWatch(selector) {
  // A check that throws between start and stop (a jumpTo error, a page
  // hiccup) would otherwise leave the previous MutationObserver running on
  // document.body for the rest of the session, and orphan it here too — so
  // clear it inline. stopFadeWatch cannot be called by reference: Playwright
  // serializes this function by its own source text alone.
  if (window.__fadeWatch) {
    window.__fadeWatch.observer.disconnect();
    delete window.__fadeWatch;
  }
  const samples = [];
  const record = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches?.(selector)) samples.push(Number(getComputedStyle(node).opacity));
    if (node.querySelectorAll) {
      for (const el of node.querySelectorAll(selector)) {
        samples.push(Number(getComputedStyle(el).opacity));
      }
    }
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) record(node);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.__fadeWatch = { observer, samples };
}

export function stopFadeWatch() {
  const state = window.__fadeWatch;
  if (!state) return [];
  state.observer.disconnect();
  delete window.__fadeWatch;
  return state.samples;
}
