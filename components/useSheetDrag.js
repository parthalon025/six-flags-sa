'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Drag the sheet the way a phone's sheet drags.
 *
 * The grab handle used to be a button that cycled peek → half → full, which
 * works but is not what a thumb reaches for: a sheet is a thing you pull. So
 * the handle now follows the finger in real time and snaps to the nearest stop
 * when you let go — and the stop it picks accounts for how fast you were
 * moving, because a short fast flick means "all the way up", not "up a bit".
 *
 * The tap is still there. A press that never travels more than a few pixels is
 * a tap, and the caller's own onClick fires as it always did; only a press that
 * actually moved turns into a drag, and that one swallows the click the browser
 * emits after it so a drag never doubles as a cycle.
 *
 * @param stops  the detents in pixels, from the caller because only it knows
 *               the viewport. Any number of them, in any order — the floor and
 *               the ceiling are taken from the values rather than named, so a
 *               stop added later needs no change here.
 * @param stop   the stop the sheet is resting at now
 * @param onStop called with the name of the stop to settle on
 */
export default function useSheetDrag({ stops, stop, onStop }) {
  const [height, setHeight] = useState(null);
  const from = useRef(null); // {y, h} at pointerdown, null when not pressing
  const last = useRef({ y: 0, t: 0, v: 0 }); // for the release velocity
  const moved = useRef(false);
  const dragged = useRef(false); // a drag just ended — swallow its click
  const live = useRef(null); // the height in flight, without a render to read it

  const settle = useCallback(
    (px) => {
      // How far the sheet would coast at the speed it was let go at. 140ms of
      // projection is enough for a flick to carry past the next stop without a
      // slow drag ever overshooting the one it was aimed at.
      const projected = px + last.current.v * 140;
      let best = stop;
      let bestGap = Infinity;
      Object.entries(stops).forEach(([name, at]) => {
        const gap = Math.abs(projected - at);
        if (gap < bestGap) {
          bestGap = gap;
          best = name;
        }
      });
      return best;
    },
    [stops, stop],
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
      from.current = { y: e.clientY, h: stops[stop] ?? Math.min(...Object.values(stops)) };
      last.current = { y: e.clientY, t: e.timeStamp, v: 0 };
      moved.current = false;
    },
    [stops, stop],
  );

  const onPointerMove = useCallback(
    (e) => {
      if (!from.current) return;
      const dy = from.current.y - e.clientY; // up is positive: the sheet grows
      if (!moved.current) {
        if (Math.abs(dy) < 5) return;
        moved.current = true;
      }
      const dt = Math.max(1, e.timeStamp - last.current.t);
      last.current = {
        y: e.clientY,
        t: e.timeStamp,
        v: (last.current.y - e.clientY) / dt,
      };
      const heights = Object.values(stops);
      const floor = Math.min(...heights);
      const ceiling = Math.max(...heights);
      const next = Math.max(floor, Math.min(ceiling, from.current.h + dy));
      live.current = next;
      setHeight(next);
    },
    [stops],
  );

  const end = useCallback(
    (e) => {
      if (!from.current) return;
      const was = moved.current;
      const px = live.current ?? from.current.h;
      from.current = null;
      moved.current = false;
      live.current = null;
      setHeight(null);
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (!was) return; // a tap — the caller's onClick still owns it
      dragged.current = true;
      onStop(settle(px));
    },
    [onStop, settle],
  );

  /** True once, immediately after a drag: the click it produced is not a tap. */
  const swallowClick = useCallback(() => {
    if (!dragged.current) return false;
    dragged.current = false;
    return true;
  }, []);

  return {
    height,
    dragging: height != null,
    swallowClick,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}
