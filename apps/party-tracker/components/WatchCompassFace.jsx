'use client';

import { formatDistance } from '@/lib/geo';
import { buildCompassMarks } from '@/lib/compass';

/**
 * Apple Watch–style Compass dial preview (same mark language as the phone strip).
 */
export default function WatchCompassFace({
  me,
  heading,
  members,
  meet,
  go,
  selection,
  planNext,
  showParty = true,
  showMeet = true,
  density = 'glance',
  nextTurn = null,
  alwaysOnPreview = null,
}) {
  const built = buildCompassMarks({
    me,
    heading,
    members,
    meet,
    go,
    selection,
    planNext,
    showParty,
    showMeet,
    includeNorth: true,
  });

  if (alwaysOnPreview?.mode === 'blank') {
    return (
      <div className="watchFace blank" aria-label="Watch Compass Always On off">
        <span className="watchBlank">Raise to wake</span>
      </div>
    );
  }

  if (alwaysOnPreview?.mode === 'calm') {
    return (
      <div className="watchFace calm" aria-label="Watch Compass Always On calm">
        {nextTurn?.label ? (
          <div className="watchTurn">{nextTurn.label}</div>
        ) : (
          <div className="watchTurn muted">—</div>
        )}
        <div className="watchRange">
          {Number.isFinite(alwaysOnPreview.primaryDistanceM)
            ? formatDistance(alwaysOnPreview.primaryDistanceM)
            : '—'}
        </div>
      </div>
    );
  }

  if (built.emptyReason === 'no-facing') {
    return (
      <div className="watchFace empty" aria-label="Watch Compass">
        <span className="watchBlank">Need facing</span>
      </div>
    );
  }

  const size = 168;
  const cx = size / 2;
  const cy = size / 2;
  const r = density === 'detail' ? 68 : 62;
  const head = built.facing ?? 0;
  const rel = (deg) => ((deg - head + 540) % 360) - 180;

  function polar(deg, rad) {
    const a = ((rel(deg) - 90) * Math.PI) / 180;
    return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) };
  }

  const markLimit = density === 'glance' ? 4 : density === 'split' ? 6 : 12;
  const dialMarks = built.marks
    .filter((m) => m.kind !== 'north' || density !== 'glance')
    .slice(0, markLimit);
  // Always keep N in glance as quiet tick
  const north = built.marks.find((m) => m.kind === 'north');
  if (density === 'glance' && north && !dialMarks.some((m) => m.kind === 'north')) {
    dialMarks.push(north);
  }

  return (
    <div className={`watchFace density-${density}`} aria-label="Watch Compass">
      {nextTurn?.label && density !== 'detail' && (
        <div className="watchTurn">{nextTurn.label}</div>
      )}
      {density === 'split' && <div className="watchSplitBand" />}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} className="watchDial" fill="none" />
        <line
          x1={cx}
          y1={cy - r}
          x2={cx}
          y2={cy - r + 10}
          className="watchFacing"
          strokeWidth={3}
          strokeLinecap="round"
        />
        {dialMarks.map((m) => {
          const p = polar(m.bearing, r - 8);
          if (m.kind === 'north') {
            return (
              <text key="n" x={p.x} y={p.y + 4} textAnchor="middle" className="watchN">
                N
              </text>
            );
          }
          if (m.kind === 'meet') {
            return (
              <polygon
                key={m.placeKey}
                points={`${p.x},${p.y - 6} ${p.x + 5},${p.y + 4} ${p.x - 5},${p.y + 4}`}
                className="watchMeet"
              />
            );
          }
          const rad = m.kind === 'primary' ? 7 : 4.5;
          return (
            <circle
              key={m.placeKey}
              cx={p.x}
              cy={p.y}
              r={rad}
              className={m.kind === 'primary' ? 'watchPrimary' : 'watchMember'}
            />
          );
        })}
        <text x={cx} y={cy + 4} textAnchor="middle" className="watchRangeText">
          {built.primary && Number.isFinite(built.primary.distanceM)
            ? formatDistance(built.primary.distanceM)
            : '—'}
        </text>
        {built.primary?.label && (
          <text x={cx} y={cy + 18} textAnchor="middle" className="watchDest">
            {built.primary.label.slice(0, 16)}
          </text>
        )}
      </svg>
    </div>
  );
}
