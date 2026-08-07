'use client';

import { useEffect, useRef } from 'react';
import { bearing, cardinal, distance, formatDistance } from '@/lib/geo';

const SPAN = 140;

export default function CompassTape({ me, members, meet, selected, heading }) {
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
      g.strokeStyle = major ? '#5E6779' : '#2E3648';
      g.beginPath();
      g.moveTo(x, h - 1);
      g.lineTo(x, major ? h - 11 : h - 6);
      g.stroke();
      if (major) {
        g.fillStyle = '#8892A6';
        g.font = '500 9px "IBM Plex Mono", monospace';
        g.fillText(cardinal(d), x, h - 14);
      }
    }

    g.strokeStyle = '#FFC24A';
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
        c: m.status === 'NEED HELP' ? '#E2503F' : m.colour,
        t: m.initials,
      });
    });
    if (meet) {
      pins.push({
        b: bearing(me.lat, me.lng, meet.lat, meet.lng),
        d: distance(me.lat, me.lng, meet.lat, meet.lng),
        c: '#E2503F',
        t: '\u2605',
      });
    }
    if (selected) {
      pins.push({
        b: bearing(me.lat, me.lng, selected.lat, selected.lng),
        d: distance(me.lat, me.lng, selected.lat, selected.lng),
        c: '#FFC24A',
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
      g.fillStyle = '#10131C';
      g.font = '700 9px "IBM Plex Mono", monospace';
      if (clamped) {
        g.beginPath();
        g.moveTo(x + Math.sign(r) * 4, 13);
        g.lineTo(x - Math.sign(r) * 2, 9);
        g.lineTo(x - Math.sign(r) * 2, 17);
        g.fill();
      } else {
        g.fillText(p.t, x, 16);
      }
      g.fillStyle = '#8892A6';
      g.font = '500 8px "IBM Plex Mono", monospace';
      g.fillText(formatDistance(p.d).replace(' ', ''), x, 30);
    });
  }, [me, members, meet, selected, heading]);

  return (
    <div className="tape">
      <canvas ref={ref} />
      <span className="tapeMode">{heading == null ? 'north-up' : 'compass'}</span>
    </div>
  );
}
