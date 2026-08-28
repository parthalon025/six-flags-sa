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
import { worldLodVisibility } from '../../../apps/party-tracker/lib/worldLod.js';

/** Every World layer some zoom hides, read from the LOD table rather than
 *  restated — a layer added to a hide-group there must not be able to keep
 *  claiming here that it is drawn at every zoom. */
const LOD_HIDDEN_LAYERS = new Set(
  Object.keys(worldLodVisibility({ detail: false, service: false, close: false }))
    .map((key) => key.replace(/-case$/, '')),
);

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

  'smooth-bends'(params, style, layers) {
    const failures = [];
    const checked = [];
    for (const id of params.layers || []) {
      const layer = layers.get(worldLayer(id));
      if (!layer) continue;
      checked.push(id);
      // MapLibre's defaults are butt caps and mitre joins, so an absent value
      // is a square corner rather than an unset one — `!== 'round'` is the
      // check, not `=== 'butt'`.
      if (layer.layout?.['line-cap'] !== 'round') {
        failures.push(`${id} ends square (line-cap ${layer.layout?.['line-cap'] ?? 'butt, by default'})`);
      }
      if (layer.layout?.['line-join'] !== 'round') {
        failures.push(`${id} spikes at its bends (line-join ${layer.layout?.['line-join'] ?? 'miter, by default'})`);
      }
      const casing = layers.get(worldCaseLayer(id));
      if (casing && (casing.layout?.['line-cap'] !== 'round' || casing.layout?.['line-join'] !== 'round')) {
        failures.push(`${id}'s casing does not bend with it, so the smoothing shows as a fringe`);
      }
    }
    return { failures, checked };
  },

  'ramps-with-zoom'(params, style, layers) {
    const { layer: id, wideZoom, walkingZoom, maxAtWide, maxOpacityAtWide } = params;
    const layer = layers.get(worldLayer(id));
    if (!layer) return { failures: [], checked: [] };
    const failures = [];
    const wide = lineWidthAt(layer.paint?.['line-width'], wideZoom);
    const walking = lineWidthAt(layer.paint?.['line-width'], walkingZoom);
    if (wide === null || walking === null) {
      return { failures: [`${id} line-width is not a width this check can read`], checked: [id] };
    }
    /* A constant width passes every absolute cap you could write and is
       exactly the thing this rule exists to refuse, so the ratio is the
       check: the layer has to actually thin out, not merely be thin. */
    if (!(wide < walking)) {
      failures.push(`${id} is ${wide}px at park-wide and ${walking}px at walking scale — it does not thin out at all`);
    } else if (wide > walking * maxAtWide) {
      failures.push(
        `${id} keeps ${(wide / walking * 100).toFixed(0)}% of its walking width at park-wide, over the ${maxAtWide * 100}% this decision allows`,
      );
    }
    const opacity = lineWidthAt(layer.paint?.['line-opacity'] ?? 1, wideZoom);
    if (opacity !== null && opacity > maxOpacityAtWide) {
      failures.push(`${id} is at ${opacity} opacity at park-wide, over the ${maxOpacityAtWide} this decision allows`);
    }
    return { failures, checked: [id] };
  },

  'drawn-at-every-zoom'(params, style, layers) {
    const { layer: id, wideZoom, maxWidthAtWide, maxOpacityAtWide, againstAtWide, maxRatioAtWide } = params;
    const layer = layers.get(worldLayer(id));
    if (!layer) return { failures: [], checked: [] };
    const failures = [];

    /* Half one: nothing may hide it. The LOD table is the only thing that
       toggles a World layer off, so a layer it does not name is drawn at
       every zoom — and a layer it names is not, whatever its paint says. */
    if (LOD_HIDDEN_LAYERS.has(id)) {
      failures.push(`${id} is in a zoom hide-group, so it is not drawn at park-wide however it is painted`);
    }

    /* Half two: and being always-drawn must not become clutter. Both are the
       decision; asserting only the first ships spaghetti, only the second
       ships an invisible layer. */
    const width = lineWidthAt(layer.paint?.['line-width'], wideZoom);
    if (width !== null && width > maxWidthAtWide) {
      failures.push(`${id} is ${width}px at park-wide zoom ${wideZoom}, over the ${maxWidthAtWide}px this decision allows`);
    }
    const opacity = lineWidthAt(layer.paint?.['line-opacity'] ?? 1, wideZoom);
    if (opacity !== null && opacity > maxOpacityAtWide) {
      failures.push(`${id} is at ${opacity} opacity at park-wide, over the ${maxOpacityAtWide} this decision allows`);
    }
    /* It may lead the midway at park-wide — it is the landmark a guest looks
       for — but not dominate it. A ceiling rather than "thinner than", because
       the midway ramps down too: "thinner than the midway" would now mean
       under a pixel, which is the invisible coaster this decision exists to
       stop. */
    const other = layers.get(worldLayer(againstAtWide));
    const otherWidth = other ? lineWidthAt(other.paint?.['line-width'], wideZoom) : null;
    if (width !== null && otherWidth !== null && width > otherWidth * maxRatioAtWide) {
      failures.push(
        `${id} is ${(width / otherWidth).toFixed(2)}× ${againstAtWide} at park-wide (${width}px vs ${otherWidth}px), over the ${maxRatioAtWide}× this decision allows — it leads there, it does not take over`,
      );
    }
    return { failures, checked: [id] };
  },

  'area-edge-drawn-as-outline'(params, style, layers) {
    const { layer: id, shapeBeneath } = params;
    const outline = layers.get(worldLayer(id));
    if (!outline) return { failures: [], checked: [] };
    const shape = layers.get(worldLayer(shapeBeneath));
    const failures = [];
    if (!shape) {
      failures.push(`${id} draws an outline with no \`${shapeBeneath}\` shape under it to be the edge of`);
    } else {
      if (shape.type !== 'fill') {
        failures.push(`${id} is only an outline because \`${shapeBeneath}\` is the shape — but ${shapeBeneath} is painted as \`${shape.type}\``);
      }
      if (!(indexOfLayer(style, worldLayer(shapeBeneath)) < indexOfLayer(style, worldLayer(id)))) {
        failures.push(`${shapeBeneath} must be painted under ${id} for ${id} to read as its edge`);
      }
    }
    return { failures, checked: [id, shapeBeneath] };
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
    // An area layer drawn as the edge of the shape beneath it is accounted
    // for too — by a rule that checks that shape is still there.
    ...decisions.decisions
      .filter((d) => d.rule === 'area-edge-drawn-as-outline')
      .map((d) => d.params?.layer),
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
