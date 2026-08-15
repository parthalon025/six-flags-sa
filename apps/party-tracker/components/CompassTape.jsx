'use client';

import { useEffect, useRef } from 'react';
import { cardinal, formatDistance } from '@/lib/geo';
import { buildCompassMarks } from '@/lib/compass';

const SPAN = 140;

/* A canvas cannot inherit a custom property, so the tape reads the resolved
   tokens off the document each time it paints. `theme` is in the dependency
   list purely as a repaint trigger — without it the tape keeps yesterday's
   palette after the appearance is toggled. */
const UI = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

/**
 * Phone Compass strip — facing-relative game radar (ADR-0011).
 * Silhouette-first: fat center tick, high-contrast marks; range on primary only.
 */
export default function CompassTape({
  me,
  members,
  meet,
  selected,
  go,
  planNext,
  heading,
  theme,
  lowered,
  showParty = true,
  showMeet = true,
}) {
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
    const cs = getComputedStyle(document.documentElement);
    const token = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    const cTick = token('--label4', 'rgba(235,235,245,.16)');
    const cTickMajor = token('--label3', 'rgba(235,235,245,.30)');
    const cLabel = token('--label2', 'rgba(235,235,245,.60)');
    const cTint = token('--blue', '#0a84ff');
    const cRed = token('--red', '#ff453a');
    const cOnPin = token('--bg', '#000');
    const cQuiet = token('--label3', 'rgba(235,235,245,.45)');

    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const built = buildCompassMarks({
      me,
      heading,
      members,
      meet,
      go,
      selection: selected,
      planNext,
      includeNorth: true,
      showParty,
      showMeet,
    });

    if (built.emptyReason === 'no-facing') {
      g.fillStyle = cLabel;
      g.font = `600 12px ${UI}`;
      g.textAlign = 'center';
      g.fillText('Turn on compass facing', w / 2, h / 2 + 4);
      return;
    }

    const head = built.facing;
    const ppd = w / SPAN;
    const rel = (d) => ((d - head + 540) % 360) - 180;

    g.textAlign = 'center';
    for (let d = 0; d < 360; d += 15) {
      const r = rel(d);
      if (Math.abs(r) > SPAN / 2) continue;
      const x = w / 2 + r * ppd;
      const major = d % 90 === 0;
      g.strokeStyle = major ? cTickMajor : cTick;
      g.beginPath();
      g.moveTo(x, h - 1);
      g.lineTo(x, major ? h - 10 : h - 5);
      g.stroke();
      if (major && d !== 0) {
        g.fillStyle = cQuiet;
        g.font = `600 9px ${UI}`;
        g.fillText(cardinal(d), x, h - 13);
      }
    }

    // Fat facing tick — silhouette-first center.
    g.strokeStyle = cTint;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(w / 2, h);
    g.lineTo(w / 2, h - 18);
    g.stroke();
    g.lineWidth = 1;

    built.marks.forEach((p) => {
      let r = rel(p.bearing);
      let clamped = false;
      if (Math.abs(r) > SPAN / 2) {
        r = Math.sign(r) * (SPAN / 2);
        clamped = true;
      }
      const x = w / 2 + r * ppd;

      if (p.kind === 'north') {
        g.fillStyle = cQuiet;
        g.font = `700 11px ${UI}`;
        g.fillText('N', x, 16);
        return;
      }

      const radius = p.kind === 'primary' ? 11 : p.kind === 'meet' ? 9 : 7;
      g.fillStyle = p.help ? cRed : p.kind === 'primary' ? cTint : p.kind === 'meet' ? cRed : p.colour || cLabel;
      if (p.kind === 'meet' && !clamped) {
        g.beginPath();
        g.moveTo(x, 4);
        g.lineTo(x + radius * 0.7, 4 + radius * 1.4);
        g.lineTo(x - radius * 0.7, 4 + radius * 1.4);
        g.closePath();
        g.fill();
      } else {
        g.beginPath();
        g.arc(x, 13, radius, 0, Math.PI * 2);
        g.fill();
      }

      g.fillStyle = cOnPin;
      g.font = `700 ${p.kind === 'primary' ? 11 : 9}px ${UI}`;
      if (clamped) {
        g.beginPath();
        g.moveTo(x + Math.sign(r) * 5, 13);
        g.lineTo(x - Math.sign(r) * 2, 8);
        g.lineTo(x - Math.sign(r) * 2, 18);
        g.fill();
      } else if (p.kind === 'primary') {
        g.fillText('●', x, 16);
      } else if (p.kind === 'meet') {
        /* triangle already drawn */
      } else {
        g.fillText(p.initials || '?', x, 16);
      }

      if (p.showDistance && Number.isFinite(p.distanceM)) {
        g.fillStyle = cLabel;
        g.font = `600 10px ${UI}`;
        g.fillText(formatDistance(p.distanceM).replace(' ', ''), x, 32);
      }
    });
  }, [me, members, meet, selected, go, planNext, heading, theme, showParty, showMeet]);

  return (
    <div className={`tape ${lowered ? 'lowered' : ''}`} role="img" aria-label="Compass">
      <canvas ref={ref} />
      <span className="tapeMode">{heading == null ? 'no facing' : 'compass'}</span>
    </div>
  );
}
