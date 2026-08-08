'use client';

import { useEffect, useRef } from 'react';
import { bearing, cardinal, distance, formatDistance } from '@/lib/geo';

const SPAN = 140;

/* The tape is drawn on a canvas, so it cannot inherit the stylesheet the
   way the rest of the chrome does — it has to go and read it. These are
   the same tokens every other surface uses, resolved once per paint, so
   the tape changes with the day/night toggle instead of staying dark
   over a paper map. */
const UI = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';

function inkOf(el) {
  const css = getComputedStyle(el);
  const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    tick: read('--label-3', 'rgba(235,235,245,.32)'),
    tickMajor: read('--label-2', 'rgba(235,235,245,.62)'),
    text: read('--label-2', 'rgba(235,235,245,.62)'),
    tint: read('--tint', '#0A84FF'),
    danger: read('--sys-red', '#FF453A'),
    onTint: read('--tint-ink', '#FFFFFF'),
    quiet: read('--label-3', 'rgba(235,235,245,.32)'),
  };
}

export default function CompassTape({ me, members, meet, selected, heading, lowered, theme }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const box = canvas.parentElement;
    const w = box.clientWidth;
    const h = box.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d');
    const ink = inkOf(canvas);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const ppd = w / SPAN;
    const head = heading ?? 0;
    const rel = (d) => ((d - head + 540) % 360) - 180;

    g.textAlign = 'center';
    for (let d = 0; d < 360; d += 5) {
      const r = rel(d);
      if (Math.abs(r) > SPAN / 2) continue;
      const x = w / 2 + r * ppd;
      const major = d % 45 === 0;
      g.strokeStyle = major ? ink.tickMajor : ink.tick;
      g.beginPath();
      g.moveTo(x, h - 1);
      g.lineTo(x, major ? h - 11 : h - 6);
      g.stroke();
      if (major) {
        g.fillStyle = ink.text;
        g.font = `600 10px ${UI}`;
        g.fillText(cardinal(d), x, h - 14);
      }
    }

    g.strokeStyle = ink.tint;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(w / 2, h);
    g.lineTo(w / 2, h - 16);
    g.stroke();
    g.lineWidth = 1;

    if (!me) return;
    const pins = [];
    members.forEach((m) => {
      pins.push({
        b: bearing(me.lat, me.lng, m.lat, m.lng),
        d: distance(me.lat, me.lng, m.lat, m.lng),
        c: m.status === 'NEED HELP' ? ink.danger : m.colour,
        t: m.initials,
      });
    });
    if (meet) {
      pins.push({
        b: bearing(me.lat, me.lng, meet.lat, meet.lng),
        d: distance(me.lat, me.lng, meet.lat, meet.lng),
        c: ink.danger,
        t: '\u2605',
      });
    }
    if (selected) {
      pins.push({
        b: bearing(me.lat, me.lng, selected.lat, selected.lng),
        d: distance(me.lat, me.lng, selected.lat, selected.lng),
        c: ink.tint,
        t: '\u25C6',
      });
    }

    pins.forEach((p) => {
      let r = rel(p.b);
      let clamped = false;
      if (Math.abs(r) > SPAN / 2) {
        r = Math.sign(r) * (SPAN / 2);
        clamped = true;
      }
      const x = w / 2 + r * ppd;
      g.fillStyle = p.c;
      g.beginPath();
      g.arc(x, 13, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = ink.onTint;
      g.font = `700 10px ${UI}`;
      if (clamped) {
        g.beginPath();
        g.moveTo(x + Math.sign(r) * 4, 13);
        g.lineTo(x - Math.sign(r) * 2, 9);
        g.lineTo(x - Math.sign(r) * 2, 17);
        g.fill();
      } else {
        g.fillText(p.t, x, 16);
      }
      g.fillStyle = ink.quiet;
      g.font = `500 9px ${UI}`;
      g.fillText(formatDistance(p.d).replace(' ', ''), x, 30);
    });
    // `theme` is not read here, but it is what changes the tokens above.
  }, [me, members, meet, selected, heading, theme]);

  return (
    <div className={`tape ${lowered ? 'lowered' : ''}`}>
      <canvas ref={ref} />
      <span className="tapeMode">{heading == null ? 'north-up' : 'compass'}</span>
    </div>
  );
}
