/**
 * Map theme tokens — palettes (Trail / Park Midnight) and Skin paint packs.
 * Skins restyle, never reposition. Paint lives in lib/world.js.
 */

import { mapPaint, mapThemeCssVars as skinCssVars, SKINS } from './world.js';

export const MAP_THEME_PACKS = {
  day: mapPaint('day'),
  night: mapPaint('night'),
  ...Object.fromEntries(Object.keys(SKINS).map((id) => [id, mapPaint(id)])),
};

export function mapThemePack(themeId = 'night') {
  return mapPaint(themeId);
}

export const mapThemeCssVars = skinCssVars;
