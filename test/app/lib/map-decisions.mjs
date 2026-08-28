/**
 * The map's drawn decisions, checked against a style.
 *
 * `test/app/map-decisions.json` is the record — one row per decision, in the
 * words it was asked for. This is the part that reads a MapLibre style and
 * says whether the decision is still true.
 *
 * It is a library rather than a suite because the same check has to run twice
 * over two different styles, and a decision that holds in one and not the
 * other is exactly the failure this is for:
 *
 *   1. `map-decisions.test.mjs` runs it over `bandedWorldStyle()`'s answer —
 *      fast, every venue, no browser. That catches a paint edit.
 *   2. `functional.mjs` runs it over `getStyle()` from a real MapLibre that a
 *      real phone loaded. That catches everything between the module and the
 *      glass: a renderer that overrides paint, a Skin's custom map layered on
 *      top, an adapter that never added the layer at all.
 *
 * A style is plain JSON either way, which is what lets one checker do both.
 *
 * Interface:
 *   loadMapDecisions()
 *   checkMapDecisions(style, { decisions?, require? })
 *   lineWidthAt(value, zoom)
 */
import { readFileSync } from 'node:fs';
import { WORLD_LAYERS } from '../../../apps/party-tracker/lib/worldGeo.js';
import { worldCaseLayer, worldLayer } from '../../../apps/party-tracker/lib/mapViewStyle.js';

const REGISTRY = new URL('../map-decisions.json', import.meta.url);

/** Layer ids whose truth geometry is an area, and whose geometry is a way. */
export const AREA_LAYER_IDS = Object.freeze(
  WORLD_LAYERS.filter((l) => l.geometry === 'polygon').map((l) => l.id),
);
export const WAY_LAYER_IDS = Object.freeze(
  WORLD_LAYERS.filter((l) => l.geometry === 'line').map((l) => l.id),
);

export function loadMapDecisions() {
  return JSON.parse(readFileSync(REGISTRY, 'utf8'));
}

/**
 * A `line-width` at one zoom.
 *
 * A width is either a number or the zoom ramp the style writes as
 * `['interpolate', ['linear'], ['zoom'], z0, w0, z1, w1, …]`. Reading only the
 * number form is how a rule quietly stops checking the day a layer grows a
 * ramp, so the ramp is evaluated rather than skipped: clamped at the ends,
 * linear between the stops that bracket the zoom.
 */
export function lineWidthAt(value, zoom) {
  if (typeof value === 'number') return value;
  if (!Array.isArray(value) || value[0] !== 'interpolate') return null;
  const [, , input, ...stops] = value;
  if (!Array.isArray(input) || input[0] !== 'zoom') return null;
  if (stops.length < 2 || stops.length % 2 !== 0) return null;
  const zs = [];
  const ws = [];
  for (let i = 0; i < stops.length; i += 2) {
    if (typeof stops[i] !== 'number' || typeof stops[i + 1] !== 'number') return null;
    zs.push(stops[i]);
    ws.push(stops[i + 1]);
  }
  if (zoom <= zs[0]) return ws[0];
  if (zoom >= zs[zs.length - 1]) return ws[ws.length - 1];
  for (let i = 0; i < zs.length - 1; i += 1) {
    if (zoom >= zs[i] && zoom <= zs[i + 1]) {
      const span = zs[i + 1] - zs[i];
      const t = span === 0 ? 0 : (zoom - zs[i]) / span;
      return ws[i] + t * (ws[i + 1] - ws[i]);
    }
  }
  return null;
}

const layerById = (style) => new Map((style?.layers || []).map((l) => [l.id, l]));
const indexOfLayer = (style, id) => (style?.layers || []).findIndex((l) => l.id === id);

/* Each rule answers with a list of failure strings — empty when the decision
   still holds — plus the layer ids it actually looked at. The second half is
   what keeps a rule from passing by looking at nothing: a venue with no
   coaster has no coaster layer, and a check that silently skipped it would
   report the decision as kept on a map that never drew it. */
const RULES = {
  'area-layers-are-shapes'(params, style, layers) {
    const covers = params.covers || [];
    const failures = [];
    const checked = [];
    for (const id of covers) {
      const layer = layers.get(worldLayer(id));
      if (!layer) continue;
      checked.push(id);
      if (layer.type !== 'fill') {
        failures.push(`${id} is an area in truth but is painted as \`${layer.type}\` — a shape was asked for, not an outline`);
      }
    }
    return { failures, checked };
  },

  'min-line-width'(params, style, layers) {
    const { layer: id, zoom, atLeast } = params;
    const layer = layers.get(worldLayer(id));
    if (!layer) return { failures: [], checked: [] };
    const width = lineWidthAt(layer.paint?.['line-width'], zoom);
    if (width === null) {
      return { failures: [`${id} line-width is not a width this check can read: ${JSON.stringify(layer.paint?.['line-width'])}`], checked: [id] };
    }
    const failures = width >= atLeast
      ? []
      : [`${id} is ${width}px at zoom ${zoom}, under the ${atLeast}px this decision asked for`];
    return { failures, checked: [id] };
  },

  'line-weight-order'(params, style, layers) {
    const order = params.order || [];
    const present = [];
    for (const id of order) {
      const layer = layers.get(worldLayer(id));
      if (!layer || layer.type !== 'line') continue;
      const width = lineWidthAt(layer.paint?.['line-width'], params.zoom ?? 16);
      if (width === null) continue;
      present.push({ id, width });
    }
    const failures = [];
    for (let i = 0; i < present.length - 1; i += 1) {
      const heavier = present[i];
      const lighter = present[i + 1];
      if (!(heavier.width > lighter.width)) {
        failures.push(
          `${heavier.id} (${heavier.width}px) must draw heavier than ${lighter.id} (${lighter.width}px)`,
        );
      }
    }
    return { failures, checked: present.map((p) => p.id) };
  },

  'paint-order'(params, style) {
    const failures = [];
    const checked = [];
    for (const [under, over] of params.pairs || []) {
      const a = indexOfLayer(style, worldLayer(under));
      const b = indexOfLayer(style, worldLayer(over));
      if (a < 0 || b < 0) continue;
      checked.push(under, over);
      if (!(b > a)) failures.push(`${over} must be painted over ${under}`);
    }
    return { failures, checked };
  },

  'has-casing'(params, style, layers) {
    const failures = [];
    const checked = [];
    for (const id of params.layers || []) {
      const layer = layers.get(worldLayer(id));
      if (!layer) continue;
      checked.push(id);
      const casing = layers.get(worldCaseLayer(id));
      if (!casing) {
        failures.push(`${id} has no casing layer under it`);
        continue;
      }
      const stroke = lineWidthAt(layer.paint?.['line-width'], params.zoom ?? 16);
      const under = lineWidthAt(casing.paint?.['line-width'], params.zoom ?? 16);
      if (stroke !== null && under !== null && !(under > stroke)) {
        failures.push(`${id}'s casing is ${under}px under a ${stroke}px stroke — a casing is the wider of the two`);
      }
      if (indexOfLayer(style, worldCaseLayer(id)) > indexOfLayer(style, worldLayer(id))) {
        failures.push(`${id}'s casing is painted over it rather than under it`);
      }
    }
    return { failures, checked };
  },
};

/**
 * Check a style against the decisions.
 *
 * @param {object} style a MapLibre style — `bandedWorldStyle()`'s answer, or
 *   what `map.getStyle()` handed back in a browser.
 * @param {object} [options]
 * @param {object} [options.decisions] the registry, already loaded.
 * @param {string[]} [options.require] World layer ids this style is expected
 *   to be drawing. A style missing one of them fails: rules skip a layer that
 *   is not there, so without this a venue that drew no coaster would report
 *   every coaster decision as kept.
 * @returns {{ failures: string[], checked: string[], pending: object[] }}
 */
export function checkMapDecisions(style, { decisions = loadMapDecisions(), require = [] } = {}) {
  const layers = layerById(style);
  const failures = [];
  const checked = new Set();
  const pending = [];

  for (const id of require) {
    if (!layers.has(worldLayer(id))) {
      failures.push(`this style draws no \`${id}\` layer, so nothing here checked the decisions about it`);
    }
  }

  /* The coverage claim, before any rule runs. Every area layer the World can
     carry is either covered by the shapes rule or named by a pending row —
     which is what makes a layer added next year fail on the day it lands
     rather than the day someone remembers this file. */
  const shapes = decisions.decisions.find((d) => d.rule === 'area-layers-are-shapes');
  const claimed = new Set([
    ...(shapes?.params?.covers || []),
    ...decisions.decisions.flatMap((d) => d.covers_layers || []),
  ]);
  for (const id of AREA_LAYER_IDS) {
    if (!claimed.has(id)) {
      failures.push(
        `\`${id}\` is an area layer that no decision in map-decisions.json accounts for — add it to \`covers\`, or record why it is not a shape`,
      );
    }
  }

  for (const decision of decisions.decisions) {
    if (decision.status === 'pending') {
      pending.push(decision);
      continue;
    }
    const rule = RULES[decision.rule];
    if (!rule) {
      failures.push(`decision \`${decision.id}\` names rule \`${decision.rule}\`, which nothing implements`);
      continue;
    }
    const result = rule(decision.params || {}, style, layers);
    for (const id of result.checked) checked.add(id);
    for (const failure of result.failures) failures.push(`${decision.id}: ${failure} — asked for: "${decision.asked}"`);
  }

  return { failures, checked: [...checked], pending };
}
