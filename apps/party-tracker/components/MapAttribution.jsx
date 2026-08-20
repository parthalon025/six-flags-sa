'use client';

import { osmNoticeText } from '@/lib/credits';

/**
 * The persistent ODbL notice ("© OpenStreetMap contributors") every venue
 * needs wherever OSM-derived geometry is on screen.
 *
 * Deliberately its own tiny component mounted beside ParkMap/DisplayMap in
 * app/page.js rather than inside ParkMap.jsx's own `.mapFurniture` cluster
 * (the key + scale bar): that cluster hides during route preview, walking,
 * and crowded/full sheet states (see globals.css `.mapFurniture` rules) —
 * fine for a key nobody needs mid-turn-by-turn, wrong for a license notice
 * that has to stay up whenever the map itself is. Also keeps this change out
 * of ParkMap.jsx while PR #558 is mid-flight there.
 *
 * Tapping it opens Settings → Credits, which lists every source (including
 * this one) with its license and link — see SettingsPanel.jsx's `credits`
 * topic and lib/credits.js.
 */
export default function MapAttribution({ onOpenCredits }) {
  return (
    <button type="button" className="mapAttribution" onClick={onOpenCredits}>
      {osmNoticeText()}
    </button>
  );
}
