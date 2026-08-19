/**
 * Kit brief — the contract between a map prompt and a saved kit.
 *
 * The invoking agent authors kit specs from prose ("sunny hand-drawn
 * brochure"); this module is the whole seam: the system prompt that
 * advertises the pieces vocabulary and the license-gated asset menu, and
 * the parser that turns an answer into a validated, saveable spec.
 * `resolveKit` stays the hard gate — an answer referencing art outside
 * the ledger, an unknown piece, or a made-up style never becomes a kit.
 */

import {
  resolveKit,
  TERRAIN_PIECES, SPRITE_PIECES, TEXTURE_KINDS,
  BUILDING_STYLES, TREE_STYLES, TRACK_STYLES,
} from './display-bake.mjs';
import { assetsForTarget } from './display-assets.mjs';
import { slugify } from './venue-io.mjs';

/**
 * The asset menu a brief may reference — GUIDs from the license-gated
 * ledger only, grouped the way the schema binds them. Kit briefs author
 * the flat/top-down tier, so iso-target variants never make the menu.
 */
export function assetMenu(ledger) {
  const rows = Object.values(assetsForTarget(ledger, 'flat'));
  return {
    sheets: rows.filter((r) => r.kind === 'tilesheet')
      .map((r) => `${r.id} tiles: ${Object.keys(r.import.tiles).join(', ')}`),
    sprites: rows.filter((r) => r.kind === 'sprite').map((r) => r.id),
    icons: rows.filter((r) => r.kind === 'icon').map((r) => r.id),
  };
}

/** The system prompt for a kit-authoring brief. */
export function kitBriefSystem(ledger) {
  return `You author map "kit specs" for a deterministic game-map baker.
The bake is composed of small pieces; you choose params per piece — presentation
only, never geometry. Reply with ONLY a JSON object:
{
  "id": "<kebab-case kit name>",
  "label": "<short human name>",
  "terrain": { any subset of ${Object.keys(TERRAIN_PIECES).join('|')}:
    { "base": "<css color>",
      "texture": { "kind": "${TEXTURE_KINDS.join('|')}", "color": "<css>", "density": 0..1 },
      "tiles": { "asset": "<tilesheet id>", "tile": "<tile name>", "tint": "<css, optional>" } } },
  "sprites": { any subset of:
    "tree": {"style":"${TREE_STYLES.join('|')}","canopy","highlight","shadow","scale","sprite":{"asset":"<sprite id>"}},
    "building": {"style":"${BUILDING_STYLES.join('|')}","roofs":[colors],"edge","wall","drop"},
    "slide": {"style":"${TRACK_STYLES.join('|')}","casing","colors":[colors],"width"},
    "coaster": {"style":"${TRACK_STYLES.join('|')}","rail","tie"},
    "badge": {"gate","food","restroom","shop","show","service","icons":{"<badge kind>":{"asset":"<icon id>"}}} } }
"tiles" paints that terrain with real dual-grid tile art; "style" switches how a
sprite is DRAWN (outline vs drop-shadowed buildings, tube vs mono tracks), not
just its colors. Asset ids must come from this ledger menu:
${JSON.stringify(assetMenu(ledger))}
Defaults fill anything you omit: ${JSON.stringify({ terrain: TERRAIN_PIECES, sprites: SPRITE_PIECES })}
Keep water readable as water and paths as paths, with outdoor-phone contrast.`;
}

/**
 * Parse a brief answer into a validated kit spec, ready to save.
 * Rejects before anything renders: malformed JSON, a missing id, and —
 * via resolveKit — unknown pieces, texture kinds, styles, or asset GUIDs
 * outside the flat tier of the ledger (an iso-target GUID is as unknown
 * here as a made-up one). Returns the spec with a slugified id and the
 * originating prompt recorded.
 */
export function parseKitAnswer(content, { assets, prompt }) {
  const spec = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
  if (!spec.id) throw new Error('Kit spec needs an id');
  resolveKit(spec, { assets: assetsForTarget(assets, 'flat') }); // the hard gate
  spec.id = slugify(spec.id);
  if (prompt) spec.prompt = prompt;
  return spec;
}
