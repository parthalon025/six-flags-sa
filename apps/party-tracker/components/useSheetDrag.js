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

  const onPointerDown = useCallback(
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Captured on the press rather than on the first move: the handle is
      // barely twenty pixels tall, so the pointer is off it before the drag has
      // travelled far enough to be one, and without the capture every move
      // after that lands on the map instead. Touch captures itself; a mouse
      // does not, and this is what makes the two behave alike.
      e.currentTarget.setPointerCapture?.(e.pointerId);
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
  };
}
