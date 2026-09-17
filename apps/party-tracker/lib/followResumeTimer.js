/**
 * Arms the free-look → Follow resume clock and re-arms it whenever the guest
 * moves again. The page owns Follow state; this owns only the timeout loop.
 */

import { FOLLOW_RESUME_MS, followShouldResume } from './parkMapView.js';

/**
 * Milliseconds until Follow may resume after `gesturedAt`, or null when there
 * is no gesture clock.
 *
 * @param {object} state
 * @param {number|null} [state.gesturedAt]
 * @param {number} state.now
 * @param {number} [state.resumeMs]
 */
export function followResumeWaitMs({
  gesturedAt = null,
  now,
  resumeMs = FOLLOW_RESUME_MS,
} = {}) {
  if (gesturedAt == null) return null;
  if (!Number.isFinite(now)) {
    throw new TypeError('followResumeWaitMs needs a finite `now` in ms');
  }
  return Math.max(0, resumeMs - (now - gesturedAt));
}

/**
 * @param {object} opts
 * @param {number} [opts.resumeMs]
 * @param {(state: { gesturedAt: number|null, now: number, previewing: boolean }) => boolean} [opts.shouldResume]
 * @param {() => void} opts.onResume
 * @param {() => number} [opts.now]
 * @param {(fn: () => void, ms: number) => unknown} [opts.schedule]
 * @param {(id: unknown) => void} [opts.cancel]
 */
export function createFollowResumeTimer({
  resumeMs = FOLLOW_RESUME_MS,
  shouldResume = followShouldResume,
  onResume,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = clearTimeout,
} = {}) {
  if (typeof onResume !== 'function') {
    throw new TypeError('createFollowResumeTimer needs an onResume callback');
  }

  /** @type {number|null} */
  let gesturedAt = null;
  /** @type {unknown} */
  let timer = null;

  const clearTimer = () => {
    if (timer != null) cancel(timer);
    timer = null;
  };

  const arm = (previewing = false) => {
    clearTimer();
    if (gesturedAt == null || previewing) return;
    const wait = followResumeWaitMs({ gesturedAt, now: now(), resumeMs });
    if (wait == null) return;
    timer = schedule(() => {
      timer = null;
      const at = gesturedAt;
      const clock = now();
      if (shouldResume({ gesturedAt: at, now: clock, previewing, resumeMs })) {
        onResume();
        return;
      }
      arm(previewing);
    }, wait);
  };

  return {
    stamp(at = now()) {
      gesturedAt = at;
    },
    clearGesture() {
      gesturedAt = null;
      clearTimer();
    },
    arm,
    /** Cancel a pending resume without clearing the gesture clock. */
    disarm: clearTimer,
    dispose: clearTimer,
  };
}
