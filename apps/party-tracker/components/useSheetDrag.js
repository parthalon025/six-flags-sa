'use client';

import { useCallback, useRef, useState } from 'react';
import { settleSheet } from '@/lib/sheet';

/**
 * Drag the sheet the way a phone's sheet drags.
 *
 * The grab handle used to be a button that cycled peek → half → full, which
 * works but is not what a thumb reaches for: a sheet is a thing you pull. So
 * the handle follows the finger in real time — and, since the sheet's height is
 * a number rather than one of four names, it now *stays* where the finger left
 * it. See lib/sheet.js: the named stops survive only as magnets near the ends
 * of the travel, so "all the way up" and "right down" stay easy to hit while
 * every height in between is somewhere the sheet can rest.
 *
 * The tap is still there. A press that never travels more than a few pixels is
 * a tap, and the caller's own onClick fires as it always did; only a press that
 * actually moved turns into a drag, and that one swallows the click the browser
 * emits after it so a drag never doubles as a cycle.
 *
 * @param stops   the named stops in pixels, from the caller because only it
 *                knows the viewport. The floor and the ceiling of the travel
 *                are taken from the values rather than named, so a stop added
 *                later needs no change here.
 * @param height  the height the sheet is resting at now, in pixels
 * @param onHeight called with the height to settle at, in pixels
 * @param rootRef when set, --sheetH on this element is updated during the drag
 *                instead of calling setState every pointermove
 */
export default function useSheetDrag({ stops, height, onHeight, rootRef = null }) {
  const [live, setLive] = useState(null);
  const [dragging, setDragging] = useState(false);
  const from = useRef(null); // {y, h} at pointerdown, null when not pressing
  const last = useRef({ y: 0, t: 0, v: 0 }); // for the release velocity
  const moved = useRef(false);
  const dragged = useRef(false); // a drag just ended — swallow its click
  const at = useRef(null); // the height in flight, without a render to read it
  const cssDrag = Boolean(rootRef);

  const publishHeight = useCallback(
    (px) => {
      if (cssDrag) rootRef.current?.style.setProperty('--sheetH', `${px}px`);
      else setLive(px);
    },
    [cssDrag, rootRef],
  );

  // Set when a press began on the sheet body rather than the handle: capture is
  // deferred until the gesture proves itself a drag. See beginPress below.
  const deferCapture = useRef(false);

  const onPointerDown = useCallback(
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Captured on the press rather than on the first move: the handle is
      // barely twenty pixels tall, so the pointer is off it before the drag has
      // travelled far enough to be one, and without the capture every move
      // after that lands on the map instead. Touch captures itself; a mouse
      // does not, and this is what makes the two behave alike.
      //
      // The body is the exception. Capturing there on press re-targets the
      // click the browser emits afterwards to the capturing element, so every
      // tap on a list row would be delivered to the sheet and the row would
      // never open. The body is big enough that waiting costs nothing: capture
      // is taken on the first move that clears the threshold instead.
      if (deferCapture.current) deferCapture.current = 'pending';
      else e.currentTarget.setPointerCapture?.(e.pointerId);
      // Cleared here rather than only when a click arrives: a touch drag that
      // ends off the handle produces no click at all, and a flag left standing
      // would eat the next real tap instead of the drag's own phantom one.
      dragged.current = false;
      from.current = { y: e.clientY, h: height };
      last.current = { y: e.clientY, t: e.timeStamp, v: 0 };
      moved.current = false;
    },
    [height],
  );

  const onPointerMove = useCallback(
    (e) => {
      if (!from.current) return;
      const dy = from.current.y - e.clientY; // up is positive: the sheet grows
      if (!moved.current) {
        if (Math.abs(dy) < 5) return;
        moved.current = true;
        // Now it is a drag, so take the capture the press deferred — from here
        // on the finger owns the sheet even if it leaves the sheet's bounds.
        if (deferCapture.current === 'pending') {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          deferCapture.current = true;
        }
        if (cssDrag) setDragging(true);
      }
      const dt = Math.max(1, e.timeStamp - last.current.t);
      last.current = {
        y: e.clientY,
        t: e.timeStamp,
        v: (last.current.y - e.clientY) / dt,
      };
      const heights = Object.values(stops);
      const next = Math.max(
        Math.min(...heights),
        Math.min(Math.max(...heights), from.current.h + dy),
      );
      at.current = next;
      publishHeight(next);
    },
    [stops, cssDrag, publishHeight],
  );

  const end = useCallback(
    (e) => {
      if (!from.current) return;
      const was = moved.current;
      const px = at.current ?? from.current.h;
      const v = last.current.v;
      from.current = null;
      moved.current = false;
      at.current = null;
      if (cssDrag) {
        setDragging(false);
      } else {
        setLive(null);
      }
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      deferCapture.current = false;
      if (!was) return; // a tap — the caller's onClick still owns it
      dragged.current = true;
      onHeight(settleSheet(px, stops, v));
    },
    [onHeight, stops, cssDrag],
  );

  /** True once, immediately after a drag: the click it produced is not a tap. */
  const swallowClick = useCallback(() => {
    if (!dragged.current) return false;
    dragged.current = false;
    return true;
  }, []);

  /**
   * The whole sheet drags, not just the handle.
   *
   * A handle twenty pixels tall is a small target for a thumb on a phone held
   * one-handed, and a sheet you can only move by its handle does not feel like
   * a sheet. So a press anywhere on it pulls it — *unless* the press began in
   * something that can scroll in the direction the finger is going, which is
   * the rule every native bottom sheet follows: mid-list a swipe scrolls the
   * list, and at the top of the list the same swipe pulls the sheet down.
   *
   * The decision is made once, on the first move that clears the same 5px
   * threshold a handle drag uses, and then held for the rest of the gesture —
   * a sheet that changed its mind halfway through a swipe would be worse than
   * one that never moved.
   *
   * Native touch listeners, attached here rather than through React's props,
   * because the call that stops the browser scrolling instead of us only counts
   * on a listener registered non-passive, and React's are passive by default.
   * Pointer events still drive the drag itself; touchmove exists only to say
   * "this one is ours" before the scroller acts on it.
   */
  const attachBody = useCallback(
    (el) => {
      if (!el) return undefined;

      let owner = null; // 'sheet' | 'scroll', decided on the first real move
      let startY = 0;

      const scrollerFor = (target) => {
        for (let n = target; n && n !== el.parentNode; n = n.parentElement) {
          if (!(n instanceof HTMLElement)) continue;
          const oy = getComputedStyle(n).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
        }
        return null;
      };

      const onTouchStart = (e) => {
        if (e.touches.length !== 1) return;
        owner = null;
        startY = e.touches[0].clientY;
      };

      const onTouchMove = (e) => {
        if (e.touches.length !== 1) return;
        const dy = startY - e.touches[0].clientY; // up positive: the sheet grows
        if (owner === null) {
          if (Math.abs(dy) < 5) return;
          const sc = scrollerFor(e.target);
          // Can the scroller still take this direction? Swiping up scrolls the
          // list down (scrollTop grows), so it absorbs until it hits the end;
          // swiping down only absorbs while there is something above.
          const absorbs =
            sc &&
            (dy > 0
              ? Math.ceil(sc.scrollTop) < sc.scrollHeight - sc.clientHeight - 1
              : sc.scrollTop > 0);
          owner = absorbs ? 'scroll' : 'sheet';
        }
        if (owner !== 'sheet') return;
        // Ours: keep the browser from scrolling the page underneath the drag.
        if (e.cancelable) e.preventDefault();
      };

      const onTouchEnd = () => {
        owner = null;
      };

      el.addEventListener('touchstart', onTouchStart, { passive: true });
      el.addEventListener('touchmove', onTouchMove, { passive: false });
      el.addEventListener('touchend', onTouchEnd, { passive: true });
      el.addEventListener('touchcancel', onTouchEnd, { passive: true });
      return () => {
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchmove', onTouchMove);
        el.removeEventListener('touchend', onTouchEnd);
        el.removeEventListener('touchcancel', onTouchEnd);
      };
    },
    [],
  );

  /**
   * Handlers for the sheet body. The same press-is-a-tap-until-it-travels rule
   * the handle already follows, applied to the whole surface: a press on a list
   * row that never moves opens the row, and the same press dragged 5px pulls the
   * sheet and eats the click the browser emits after it. Buttons are therefore
   * NOT excluded — most of the sheet is buttons, and excluding them would mean
   * "drag anywhere except the nine tenths of it you would actually touch".
   *
   * What is excluded is anything that owns its own drag, because two gestures on
   * one finger cannot both win: a range input (the height slider), the handle
   * (which has these handlers already), and anything opting out by hand.
   */
  const OWNS_ITS_GESTURE = 'input[type="range"], .grab, [data-own-drag]';

  const bodyHandlers = {
    onPointerDown: (e) => {
      if (e.target.closest?.(OWNS_ITS_GESTURE)) return;
      deferCapture.current = true;
      onPointerDown(e);
    },
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    /* Capture, so it runs before the control's own handler: a drag that ends on
       a button still produces a click, and without this the sheet would move
       AND the row would open. The handle solves this by asking swallowClick()
       inside its own onClick; every other control on the sheet knows nothing
       about dragging, so the sheet answers for them here. */
    onClickCapture: (e) => {
      if (!dragged.current) return;
      dragged.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };

  return {
    height: cssDrag ? null : live,
    dragging: cssDrag ? dragging : live != null,
    swallowClick,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
    /** Spread on the sheet root so the whole surface pulls, not just the handle. */
    bodyHandlers,
    /** ref callback for the sheet root — owns the non-passive touch listeners. */
    attachBody,
  };
}
