'use client';

import { GLYPHS, inkOn, symbolFor } from '@/lib/mapSymbols';

/* Rendering for the symbol vocabulary in lib/mapSymbols.js. Kept out of
   ParkMap so the legend can draw exactly the marker the map draws — a key that
   is redrawn by hand is a key that goes stale. */

/** The 24×24 glyph art, scaled to `size` and centred on the origin. */
export function Glyph({ name, size, colour, opacity = 1 }) {
  const art = GLYPHS[name];
  if (!art) return null;
  const s = size / 24;
  return (
    <g transform={`scale(${s.toFixed(4)}) translate(-12 -12)`} opacity={opacity}>
      {art.map((part, i) =>
        part.mode === 'stroke' ? (
          <path
            key={i}
            d={part.d}
            fill="none"
            stroke={colour}
            strokeWidth={part.w}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path key={i} d={part.d} fill={colour} fillRule={part.rule || 'nonzero'} />
        ),
      )}
    </g>
  );
}

/* Where the glyph sits inside each silhouette, and how much room it gets.
   A pin carries its glyph in the head, not on the point. */
function shapeOf(shape, r) {
  switch (shape) {
    case 'chip':
      return {
        d: `M${-r + r * 0.42} ${-r}h${2 * r - r * 0.84}a${r * 0.42} ${r * 0.42} 0 0 1 ${r * 0.42} ${r * 0.42}v${2 * r - r * 0.84}a${r * 0.42} ${r * 0.42} 0 0 1 ${-r * 0.42} ${r * 0.42}h${-(2 * r - r * 0.84)}a${r * 0.42} ${r * 0.42} 0 0 1 ${-r * 0.42} ${-r * 0.42}v${-(2 * r - r * 0.84)}a${r * 0.42} ${r * 0.42} 0 0 1 ${r * 0.42} ${-r * 0.42}Z`,
        gx: 0,
        gy: 0,
        gs: r * 1.28,
      };
    case 'diamond': {
      const h = r * 1.26;
      return { d: `M0 ${-h}L${h} 0L0 ${h}L${-h} 0Z`, gx: 0, gy: 0, gs: r * 1.12 };
    }
    case 'pin': {
      const tip = r * 1.65;
      return {
        d: `M0 ${tip}L${-r * 0.72} ${r * 0.28}A${r} ${r} 0 1 1 ${r * 0.72} ${r * 0.28}Z`,
        gx: 0,
        gy: -r * 0.28,
        gs: r * 1.16,
      };
    }
    default:
      return { d: null, gx: 0, gy: 0, gs: r * 1.34 };
  }
}

/**
 * One place on the map.
 *
 * `state` is height eligibility, and it is drawn rather than dimmed: opacity
 * already means "we have not heard from this person lately" over on the party
 * markers, and one channel cannot carry two meanings on the same map.
 *   'no' | 'toobig' — hollow, struck through. Not today.
 *   'companion'     — a plus badge. Rideable with a grown-up.
 */
export function PoiMarker({ category, colour, r, state, selected }) {
  const sym = symbolFor(category);
  const { d, gx, gy, gs } = shapeOf(sym.shape, r);
  const barred = state === 'no' || state === 'toobig';
  const solid = sym.shape !== 'chip';

  const fill = barred ? 'var(--markerVoid)' : solid ? colour : 'var(--markerChip)';
  const stroke = barred || !solid ? colour : 'var(--markerEdge)';
  const strokeWidth = barred ? 1.9 : solid ? 1.5 : 1.6;
  const glyphColour = barred || !solid ? colour : inkOn(colour);

  return (
    <g>
      {selected && (
        <g className="poiHalo">
          {d ? <path d={d} transform={`scale(${(1 + 5.5 / r).toFixed(3)})`} /> : <circle r={r + 5.5} />}
        </g>
      )}
      {d ? (
        <path d={d} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      ) : (
        <circle r={r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      )}
      <g transform={`translate(${gx.toFixed(2)} ${gy.toFixed(2)})`}>
        <Glyph name={category} size={gs} colour={glyphColour} opacity={barred ? 0.55 : 1} />
      </g>
      {barred && (
        <line
          x1={-r * 0.95}
          y1={r * 0.95}
          x2={r * 0.95}
          y2={-r * 0.95}
          className="poiBarred"
        />
      )}
      {state === 'companion' && (
        <g transform={`translate(${(r * 0.85).toFixed(2)} ${(r * 0.85).toFixed(2)})`}>
          <circle r={r * 0.52} fill="var(--beacon)" stroke="var(--markerEdge)" strokeWidth="1.1" />
          <path
            d={`M${-r * 0.26} 0h${r * 0.52}M0 ${-r * 0.26}v${r * 0.52}`}
            stroke="var(--markerEdge)"
            strokeWidth={r * 0.17}
            strokeLinecap="round"
          />
        </g>
      )}
    </g>
  );
}

/** The same marker, standalone, for the legend. */
export function LegendMark({ category, colour, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden="true">
      <PoiMarker category={category} colour={colour} r={size * 0.4} state="unknown" selected={false} />
    </svg>
  );
}

/** A line feature — coaster track, water ride — as it appears on the map. */
export function LegendLine({ glyph, colour, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden="true">
      <Glyph name={glyph} size={size} colour={colour} />
    </svg>
  );
}
