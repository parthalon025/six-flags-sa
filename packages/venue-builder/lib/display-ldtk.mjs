/**
 * LDtk debug export — the bake model as an inspectable level file.
 *
 * Inspection only, never a source: level designers and reviewers open the
 * bake in LDtk (ldtk.io) to walk the terrain grid and entity placements
 * with real tooling instead of squinting at a PNG. The export is derived
 * from the model every time; nothing reads it back into the pipeline.
 *
 * The file is a minimal LDtk project: one level, one IntGrid layer holding
 * the terrain cells, and one Entities layer carrying badges, trees, and
 * track vertices. Deterministic: same model in, byte-identical JSON out
 * (uids are fixed constants, not random).
 */

import { TERRAIN_NAMES } from './display-bake.mjs';

const LDTK_VERSION = '1.5.3';
const GRID = 16;

// Fixed uids — LDtk wants them unique within the file, nothing more.
const UID = { level: 1, terrainLayer: 2, entityLayer: 3, badge: 4, tree: 5, track: 6 };

/** Debug palette per terrain id — legibility in the editor, not the kit's look. */
const TERRAIN_COLORS = {
  outside: '#6B4E9B',
  ground: '#EBD9A4',
  grass: '#7FB86B',
  wood: '#639E55',
  water: '#58AEDC',
  lot: '#B9B3A6',
  road: '#8C8F98',
  service: '#7D8089',
};

const entity = (identifier, defUid, x, y, fields = []) => ({
  __identifier: identifier,
  __grid: [Math.floor(x), Math.floor(y)],
  __pivot: [0.5, 0.5],
  __worldX: Math.round(x * GRID),
  __worldY: Math.round(y * GRID),
  px: [Math.round(x * GRID), Math.round(y * GRID)],
  defUid,
  width: GRID,
  height: GRID,
  fieldInstances: fields,
});

const field = (identifier, type, value) => ({ __identifier: identifier, __type: type, __value: value });

/**
 * The bake model as an LDtk project object (serialize with JSON.stringify).
 * Pure and deterministic.
 */
export function ldtkProject(model) {
  const { cols, rows, cells } = model;
  // LDtk IntGrid values must be >= 1; terrain ids are 0-based, so shift.
  const intGridCsv = Array.from(cells, (t) => t + 1);
  const intGridValues = Object.entries(TERRAIN_NAMES).map(([id, name]) => ({
    value: Number(id) + 1,
    identifier: name,
    color: TERRAIN_COLORS[name] || '#888888',
  }));

  const entityDefs = [
    { identifier: 'Badge', uid: UID.badge, width: GRID, height: GRID, color: '#D84B4B' },
    { identifier: 'Tree', uid: UID.tree, width: GRID, height: GRID, color: '#3F7A38' },
    { identifier: 'TrackVertex', uid: UID.track, width: GRID, height: GRID, color: '#F4C542' },
  ];

  const entityInstances = [
    ...(model.badges || []).map((b) => entity('Badge', UID.badge, b.x, b.y, [
      field('kind', 'String', b.kind),
      ...(b.name ? [field('name', 'String', b.name)] : []),
    ])),
    ...(model.trees || []).map((t) => entity('Tree', UID.tree, t.x, t.y, [
      field('big', 'Bool', Boolean(t.big)),
    ])),
    ...(model.tracks || []).flatMap((tr) => tr.pts.map(([x, y], i) => entity('TrackVertex', UID.track, x, y, [
      field('kind', 'String', tr.kind),
      field('trackIdx', 'Int', tr.idx),
      field('vertex', 'Int', i),
    ]))),
  ];

  return {
    __header__: {
      fileType: 'LDtk Project JSON',
      app: 'Park Bound venue builder (debug export — derived, never a source)',
      appVersion: LDTK_VERSION,
    },
    jsonVersion: LDTK_VERSION,
    worldLayout: 'Free',
    bgColor: '#40465B',
    defs: {
      layers: [
        {
          __type: 'Entities',
          identifier: 'Entities',
          type: 'Entities',
          uid: UID.entityLayer,
          gridSize: GRID,
        },
        {
          __type: 'IntGrid',
          identifier: 'Terrain',
          type: 'IntGrid',
          uid: UID.terrainLayer,
          gridSize: GRID,
          intGridValues,
        },
      ],
      entities: entityDefs,
      tilesets: [],
      enums: [],
      externalEnums: [],
      levelFields: [],
    },
    levels: [{
      identifier: (model.venue || 'venue').replace(/[^A-Za-z0-9]/g, '_'),
      iid: 'level-0',
      uid: UID.level,
      worldX: 0,
      worldY: 0,
      pxWid: cols * GRID,
      pxHei: rows * GRID,
      layerInstances: [
        {
          __identifier: 'Entities',
          __type: 'Entities',
          __cWid: cols,
          __cHei: rows,
          __gridSize: GRID,
          iid: 'layer-entities',
          levelId: UID.level,
          layerDefUid: UID.entityLayer,
          pxOffsetX: 0,
          pxOffsetY: 0,
          visible: true,
          intGridCsv: [],
          entityInstances,
        },
        {
          __identifier: 'Terrain',
          __type: 'IntGrid',
          __cWid: cols,
          __cHei: rows,
          __gridSize: GRID,
          iid: 'layer-terrain',
          levelId: UID.level,
          layerDefUid: UID.terrainLayer,
          pxOffsetX: 0,
          pxOffsetY: 0,
          visible: true,
          intGridCsv,
          entityInstances: [],
        },
      ],
    }],
  };
}
