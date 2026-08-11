/**
 * Map theme tokens — light (Trail) and dark (Park Midnight) packs (Map M2).
 *
 * Skins restyle, never reposition. All stroke widths and colours live here.
 */

export const MAP_THEME_PACKS = {
  day: {
    id: 'day',
    label: 'Trail (light)',
    path: { stroke: '#8B7355', width: 2.2, casing: '#F5F0E8', casingWidth: 4.4 },
    building: { fill: '#E8E0D4', stroke: '#C4B8A8', width: 0.8 },
    water: { fill: '#7EC8E3', stroke: '#5BA8C4', width: 0.6 },
    grass: { fill: '#B8D4A0', stroke: 'none' },
    label: { fill: '#2C2416', halo: '#F5F0E8', fontSize: 9.5 },
    land: { fill: '#2C2416', fontSize: 15, tracking: 2.4 },
    contrastFloor: 4.5,
  },
  night: {
    id: 'night',
    label: 'Park Midnight (dark)',
    path: { stroke: '#C4A882', width: 2.4, casing: '#1A1520', casingWidth: 4.8 },
    building: { fill: '#2A2438', stroke: '#4A4060', width: 0.8 },
    water: { fill: '#1E4A5C', stroke: '#2A6880', width: 0.6 },
    grass: { fill: '#1E3020', stroke: 'none' },
    label: { fill: '#F0E8DC', halo: '#1A1520', fontSize: 9.5 },
    land: { fill: '#F0E8DC', fontSize: 15, tracking: 2.4 },
    contrastFloor: 4.5,
  },
};

export function mapThemePack(themeId = 'night') {
  return MAP_THEME_PACKS[themeId] || MAP_THEME_PACKS.night;
}

/** CSS custom properties for the active map theme pack. */
export function mapThemeCssVars(pack) {
  return {
    '--map-path-stroke': pack.path.stroke,
    '--map-path-width': `${pack.path.width}px`,
    '--map-path-casing': pack.path.casing,
    '--map-building-fill': pack.building.fill,
    '--map-water-fill': pack.water.fill,
    '--map-label-fill': pack.label.fill,
    '--map-label-halo': pack.label.halo,
  };
}
