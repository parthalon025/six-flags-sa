'use client';

import { useEffect, useState } from 'react';
import { CATEGORY_LABELS } from '@/lib/theme';
import { SYMBOLS } from '@/lib/mapSymbols';
import { LegendLine, LegendMark, PoiMarker } from './MapSymbols';

/* The key.
 *
 * A symbol nobody can name is a coloured dot with extra steps, and the place
 * you want to be told what a symbol means is the moment you are staring at it —
 * not three taps away in a settings sheet. So the key lives on the map, and
 * because every row is already a statement about what is drawn, each row is
 * also the switch that draws it.
 *
 * The category order is the order of the eye: what you came for, then what you
 * need, then what is merely there.
 */
const ORDER = [
  'coaster', 'ride', 'landmark', 'gate', 'food', 'restroom', 'show', 'service', 'shop',
  // Late, because most visitors are not staying the night — and absent
  // entirely at a venue with no campground, which is most of them.
  'campsite',
  'parking',
];

/**
 * `presentCategories` is what this venue actually has. A key is a promise that
 * the thing it names is out there on the map, and a row for a category with
 * nothing in it breaks that promise twice: it offers a switch that changes
 * nothing, and it says this place has campsites when it does not.
 */
export default function MapLegend({
  palette,
  visibleCategories,
  onToggleCategory,
  heightFilterOn,
  presentCategories = null,
  /** How many places each category has, keyed by category. Optional. */
  categoryCounts = null,
  /** Route preview and turn-by-turn HUD need the map clear — the key folds away. */
  hidden = false,
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);
  if (hidden) return null;
  // The map's own gesture handlers sit on the wrapper; a tap meant for the key
  // must not also pan the park or drop a meet-up pin.
  const swallow = (e) => e.stopPropagation();

  return (
    <div
      className={`mapKey ${open ? 'open' : ''}`}
      onPointerDown={swallow}
      onPointerMove={swallow}
      onPointerUp={swallow}
      onWheel={swallow}
    >
      <button
        type="button"
        className="mapKeyToggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <svg width="34" height="16" viewBox="-17 -8 34 16" aria-hidden="true">
          <g transform="translate(-9 0)">
            <PoiMarker category="coaster" colour={palette.categories.coaster} r={5.6} state="unknown" />
          </g>
          <g transform="translate(1 0)">
            <PoiMarker category="food" colour={palette.categories.food} r={5.4} state="unknown" />
          </g>
          <g transform="translate(10 0)">
            <PoiMarker category="restroom" colour={palette.categories.restroom} r={5.4} state="unknown" />
          </g>
        </svg>
        <span>{open ? 'Hide key' : 'Key'}</span>
      </button>

      {open && (
        <div className="mapKeyBody">
          <p className="mapKeyNote">Tap a row to show or hide it on the map.</p>
          <ul className="mapKeyList">
            {ORDER.filter((key) => SYMBOLS[key] && (!presentCategories || presentCategories.has(key))).map((key) => {
              const on = visibleCategories.has(key);
              const count = categoryCounts?.get?.(key) ?? null;
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={`mapKeyRow ${on ? 'on' : ''}`}
                    onClick={() => onToggleCategory?.(key)}
                    aria-pressed={on}
                  >
                    <LegendMark category={key} colour={palette.categories[key]} size={22} />
                    <b>{CATEGORY_LABELS[key]}</b>
                    <i>{SYMBOLS[key].hint}</i>
                    {/* How many there are, beside — not instead of — what the
                        symbol means. The twin drops the hint and keeps only
                        the count, which answers "how many of these" for a
                        symbol you still cannot name; the count is the second
                        question, not the first. It also says out loud which
                        rows are worth switching off. */}
                    {count != null && <span className="mapKeyCount">{count}</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mapKeyHead">Drawn on the ground</p>
          <ul className="mapKeyList plain">
            <li>
              <span className="mapKeyRow static">
                <LegendLine glyph="track" colour="var(--track)" size={22} />
                <b>Coaster track</b>
                <i>Tap a coaster to light up its own</i>
              </span>
            </li>
            <li>
              <span className="mapKeyRow static">
                <LegendLine glyph="water" colour="var(--slide)" size={22} />
                <b>Water rides</b>
                <i>Flumes and slides</i>
              </span>
            </li>
          </ul>

          {heightFilterOn && (
            <>
              <p className="mapKeyHead">With a height set</p>
              <ul className="mapKeyList plain">
                <li>
                  <span className="mapKeyRow static">
                    <svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true">
                      <PoiMarker
                        category="coaster"
                        colour={palette.categories.coaster}
                        barredInk={palette.barred}
                        r={7.4}
                        state="not"
                      />
                    </svg>
                    <b>Too short today</b>
                    <i>Ringed in red and struck through</i>
                  </span>
                </li>
                <li>
                  <span className="mapKeyRow static">
                    <svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true">
                      <PoiMarker category="ride" colour={palette.categories.ride} r={8} state="companion" />
                    </svg>
                    <b>Rides with a grown-up</b>
                    <i>Marked with a plus</i>
                  </span>
                </li>
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
