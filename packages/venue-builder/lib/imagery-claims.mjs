/**
 * The Map factory's imagery extraction lane — what a pass is allowed to write,
 * and the wall between what it finds and what a guest ever sees.
 *
 * ADR-0020 clause 3 splits extraction into three lanes by certainty, and the
 * split is not about accuracy. Lane A is classical CV with no RNG in it, Lane B
 * is pinned open models, Lane C is agent vision. Only Lane A may write truth,
 * and only when *that exact invocation* has been proven byte-identical across
 * consecutive runs — the CV research note found classical CV hiding
 * nondeterminism (GrabCut's unseedable k-means init, RANSAC ignoring the seed),
 * so determinism is proven per pass rather than assumed from the lane. Everything
 * else is a claim in the evidence graph, resolved by corroboration or a steward.
 *
 * The rule this module refuses to bend is that **confidence is not the gate**.
 * OSM's own import guidelines say it plainly: algorithmically generated data
 * uploaded without manual verification is a mechanical edit whatever the model
 * thinks of itself, and a decade of that community's enforcement is the closest
 * thing to a controlled experiment this problem has. A Lane B detection at 1.0
 * is a claim; a Lane A contour at 0.81 from a proven pass is truth.
 *
 * ADR-0020 clause 5 then says what happens when imagery and OSM disagree: OSM
 * stays canonical, imagery *adds* what OSM lacks and *flags* where it
 * contradicts, and nothing is ever silently moved. `disputesAgainstTruth` is
 * that flag. It reads truth and writes none: the Places and the walk geometry
 * handed to it come back untouched, which the suite asserts by comparing the
 * bytes on the way out.
 *
 * ## Where a dispute goes, and where it does not
 *
 * ADR-0021 left "how does a disputed path position reach a guest?" open. The
 * owner decided it (OWNER_DECISION_C below): **it does not**. Disputes stay
 * builder-side. The seven shipped Gap types are frozen, disputes are not routed
 * through `path` or `queue`, and the only artefact this lane produces for a
 * person is `imagery-disputes.json` under the builder's own `data/venues/`,
 * next to the other sidecars nobody ships.
 *
 * `gapWallProblems` is that wall, made checkable. What it can prove:
 *
 *   - `SHIPPED_GAP_TYPES` is still exactly the frozen seven — a cross-module
 *     freeze, so extending ship-gaps.mjs fails here rather than quietly.
 *   - no dispute kind is spelled the same as a shipped Gap type (`path_position`
 *     is deliberately not `path`).
 *   - every shipped Gap row is one of the seven and is exactly `{type, target}`,
 *     per ADR-0009's wire contract — a dispute smuggled into `gaps.json` with
 *     its metres and its tile still attached is caught here.
 *   - the maintainer record's own file lands builder-side, and the record
 *     declares neither Gap rows nor a guest audience.
 *
 * What it cannot prove, stated rather than implied: a dispute rewritten by hand
 * into a bare `{type: 'path', target: 'vortex'}` is indistinguishable, from the
 * document alone, from the path Gap ship-gaps.mjs invents for a stranded ride.
 * That case is caught by a reviewer reading the conversion code, not by a gate
 * reading the output — which is why this module contains no conversion code and
 * why the record carries no Gap-shaped field for one to grow out of.
 */

import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { metresBetween } from './evidence.mjs';
import { claimCoverage, IMAGERY_EVIDENCE_CLASSES } from './imagery-ledger.mjs';
import { SHIPPED_GAP_TYPES, resolveGapTarget, metresToWalkable } from './ship-gaps.mjs';
import { OVERRIDE_DIR, VENUE_DIR } from '../src/paths.mjs';

/** ADR-0021's open item (c), as the owner settled it. Recorded verbatim in
 *  every record this module writes, so a reader six months from now does not
 *  have to reconstruct why the disputes stop here. */
export const OWNER_DECISION_C =
  'ADR-0021 open item (c) — owner decision: imagery disagreements stay builder-side and are '
  + 'never shown to guests. The seven shipped Gap types stay frozen, and a dispute is not '
  + 'routed through the path or queue types to reach a phone.';

/**
 * The three extraction lanes of ADR-0020 clause 3.
 *
 * `sources` are `evidence.mjs` WEIGHTS keys, and they overlap between lanes on
 * purpose. Weight answers "how much is this kind of statement worth once it is
 * in the graph"; the lane answers "may this pass write truth at all". They are
 * orthogonal, and conflating them is exactly the confidence-as-gate mistake:
 * a Lane B segmentation and a Lane A segmentation are worth the same 3 in a
 * fusion and are worlds apart at the write gate.
 */
export const EXTRACTION_LANES = Object.freeze({
  A: Object.freeze({
    id: 'A',
    name: 'deterministic CV',
    sources: Object.freeze(['cv_segmentation', 'cv_detection']),
    writes: 'truth-when-proven',
    why:
      'seeded, replayable classical passes (Canny/findContours, marker-given watershed, template '
      + 'matching, GLCM/LBP, band arithmetic, SLIC) — truth only where the invocation itself is '
      + 'proven byte-identical across consecutive runs',
  }),
  B: Object.freeze({
    id: 'B',
    name: 'pinned open model',
    sources: Object.freeze(['cv_detection', 'cv_segmentation']),
    writes: 'claims-only',
    why:
      'the ONNX format does not fix floating-point operation order, so a pinned version still '
      + 'varies across runtimes, BLAS backends and thread configuration — reproducible within a '
      + 'tolerance is not byte-identical, and only byte-identical clears clause 3',
  }),
  C: Object.freeze({
    id: 'C',
    name: 'agent vision',
    sources: Object.freeze(['llm_extract']),
    writes: 'claims-only',
    why:
      'sampling is non-deterministic even at zero temperature, and the read depends on a service '
      + 'outside this repo — a semantic claim ("that cluster is a carousel") is worth having and '
      + 'is never a survey',
  }),
});

/** The sentence that has to keep being said, because every lane that ever got
 *  an exception got it by arguing about a threshold. */
const CONFIDENCE_IS_NOT_THE_GATE =
  'confidence is not part of this gate — verification is the gate (OSM Import/Guidelines: algorithmically '
  + 'generated data uploaded without manual verification is a mechanical edit, whatever the pass '
  + 'says about its own certainty)';

/**
 * Lane A primitives with RNG the caller cannot pin, and what has to be true
 * before a pass built on one may be considered for a truth write at all.
 *
 * These are the CV research note's `adopt:` triggers, kept as data so a pass
 * declares its mitigations and this module checks them, rather than a reviewer
 * remembering which of the three OpenCV traps this particular pass falls into.
 * Even a fully mitigated pass still has to clear `determinismProof` — the
 * mitigations are what make the two-run check meaningful, not a substitute for it.
 */
export const RNG_TAINTED_PRIMITIVES = Object.freeze({
  kmeans: Object.freeze({
    why: 'cv::theRNG() seeds the centre initialisation and the seed is not pinned per call',
    mitigations: Object.freeze(['seeded', 'single-thread', 'ipp-disabled']),
  }),
  grabcut: Object.freeze({
    why: "initGMMs() hard-codes a KMEANS_PP_CENTERS call with no caller-visible seed control",
    mitigations: Object.freeze(['seeded', 'single-thread', 'ipp-disabled']),
  }),
  ransac: Object.freeze({
    why: 'RANSAC estimators are documented insensitive to cv2.setRNGSeed (opencv/opencv#24835)',
    mitigations: Object.freeze(['lmeds-refit']),
  }),
  findhomography: Object.freeze({
    why: 'the default estimator is RANSAC, which ignores the seed (opencv/opencv#24835)',
    mitigations: Object.freeze(['lmeds-refit']),
  }),
  findfundamentalmat: Object.freeze({
    why: 'the default estimator is RANSAC, which ignores the seed (opencv/opencv#24835)',
    mitigations: Object.freeze(['lmeds-refit']),
  }),
});

/**
 * What an imagery pass is allowed to say it found — ADR-0020 clause 1's own
 * list ("tree positions, surface classes, water and path edges"), plus `place`
 * for the semantic reads Lane C exists for.
 *
 * A closed vocabulary rather than a free-text kind, because the alternative is
 * this lane growing a `queue_wait` or a `height_requirement` — facts imagery
 * cannot see, arriving with imagery's provenance attached.
 */
export const CLAIM_KINDS = Object.freeze(['tree', 'surface', 'water_edge', 'path_edge', 'place']);

/**
 * What a disagreement with OSM may be called.
 *
 * Every one of these is deliberately un-spellable as a shipped Gap type, and
 * `gapWallProblems` asserts that rather than trusting it. `path_position` is
 * not `path` for exactly the reason the owner decision names: the shipped
 * `path` Gap asks a guest to walk a route OSM missed, and "two sources disagree
 * about where this walkway is" is not that question and is not a guest's to
 * settle.
 */
export const DISPUTE_KINDS = Object.freeze(['place_position', 'path_position']);

/** The seven, frozen here as a literal so a change to ship-gaps.mjs collides
 *  with this module instead of passing through it. */
export const FROZEN_GAP_TYPES = Object.freeze([
  'height',
  'queue',
  'path',
  'restroom',
  'food',
  'gate',
  'camping',
]);

/**
 * Metres between an imagery read and OSM's own position before the two are
 * called different answers rather than the same one.
 *
 * NAIP is specified to within 6 m of ground control and the OSM trace carries
 * its own budget, so twelve is two of those. It is a registration allowance,
 * not a claim about how well either source did.
 */
export const AGREE_METRES = 12;

/**
 * Beyond this, an OSM feature is a different feature rather than the same one
 * in the wrong place — so a claim out here is imagery *adding* what OSM lacks,
 * which ADR-0020 clause 5 welcomes and which must not be recorded as a dispute.
 * Forty is a little past ship-gaps' 35 m stranded-ride radius: a claim farther
 * from OSM than the distance at which the builder already calls a ride
 * unreachable is not arguing with OSM about a position.
 */
export const MATCH_METRES = 40;

const upperLane = (lane) => (typeof lane === 'string' ? lane.toUpperCase() : null);

const normalisePrimitive = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Every RNG-tainted primitive this pass declares, with the mitigations it is
 *  still missing for each. Internal: it reaches a caller as the reasons on a
 *  verdict, which is the form a maintainer can act on. */
function taintedPrimitives(pass) {
  const declared = Array.isArray(pass?.primitives) ? pass.primitives : [];
  const met = new Set((Array.isArray(pass?.mitigations) ? pass.mitigations : []).map(String));
  const found = new Map();
  for (const raw of declared) {
    const norm = normalisePrimitive(raw);
    for (const [key, row] of Object.entries(RNG_TAINTED_PRIMITIVES)) {
      if (!norm.includes(key) || found.has(key)) continue;
      found.set(key, {
        primitive: key,
        declaredAs: String(raw),
        why: row.why,
        unmet: row.mitigations.filter((m) => !met.has(m)),
      });
    }
  }
  return [...found.values()];
}

/**
 * Whether this pass's output has been shown to be byte-identical run to run.
 *
 * Derived from the recorded digests rather than read off a `proven: true` flag,
 * because a flag is a claim about a check and the digests are the check. One
 * run is not evidence of anything — it is the same number twice only if you
 * count it twice.
 */
export function determinismProof(pass) {
  const digests = (Array.isArray(pass?.determinism?.digests) ? pass.determinism.digests : []).filter(
    (d) => typeof d === 'string' && d.length > 0,
  );
  if (digests.length < 2) {
    return {
      proven: false,
      runs: digests.length,
      digest: null,
      why:
        `${digests.length} recorded run(s) — byte-identical output is a fact only across at least `
        + 'two consecutive runs of this exact invocation',
    };
  }
  const [first] = digests;
  const odd = digests.find((d) => d !== first);
  if (odd) {
    return {
      proven: false,
      runs: digests.length,
      digest: null,
      why: `output digests differ across runs (${first.slice(0, 12)}… vs ${odd.slice(0, 12)}…)`,
    };
  }
  return { proven: true, runs: digests.length, digest: first, why: null };
}

/**
 * Where this pass's findings are allowed to go: `truth`, `claim`, or `refused`
 * when the pass is not a coherent pass at all.
 *
 * The reasons are the point. A pass that lands on `claim` says why in terms a
 * maintainer can act on — add a second run, declare the mitigation, state the
 * bar — rather than leaving them to infer it from a boolean.
 */
export function passVerdict(pass) {
  const laneId = upperLane(pass?.lane);
  const lane = laneId ? EXTRACTION_LANES[laneId] : null;
  const id = pass?.id ?? null;
  if (!lane) {
    return {
      lane: null,
      pass: id,
      route: 'refused',
      reasons: [
        `unknown extraction lane ${JSON.stringify(pass?.lane ?? null)} — ADR-0020 clause 3 has `
        + `${Object.keys(EXTRACTION_LANES).join(', ')}`,
      ],
    };
  }
  if (!lane.sources.includes(pass?.source)) {
    return {
      lane: laneId,
      pass: id,
      route: 'refused',
      reasons: [
        `lane ${laneId} does not emit "${pass?.source}" — it emits ${lane.sources.join(', ')}`,
      ],
    };
  }

  const reasons = [];
  if (lane.writes !== 'truth-when-proven') {
    reasons.push(`lane ${laneId} (${lane.name}) never writes truth: ${lane.why}`);
    reasons.push(CONFIDENCE_IS_NOT_THE_GATE);
    return { lane: laneId, pass: id, route: 'claim', reasons };
  }

  for (const tainted of taintedPrimitives(pass)) {
    if (!tainted.unmet.length) continue;
    reasons.push(
      `${tainted.declaredAs} is RNG-tainted (${tainted.why}); still undeclared: `
      + `${tainted.unmet.join(', ')}`,
    );
  }
  const proof = determinismProof(pass);
  if (!proof.proven) reasons.push(`determinism unproven: ${proof.why}`);
  if (!Number.isFinite(pass?.confidenceBar)) {
    reasons.push('no confidence bar stated — ADR-0020 clause 3 writes truth only above one');
  }
  if (reasons.length) {
    reasons.push(CONFIDENCE_IS_NOT_THE_GATE);
    return { lane: laneId, pass: id, route: 'claim', reasons };
  }
  return {
    lane: laneId,
    pass: id,
    route: 'truth',
    reasons: [
      `lane A, ${proof.runs} consecutive runs byte-identical (${proof.digest.slice(0, 12)}…), no `
      + `unmitigated RNG-tainted primitive, findings at or above ${pass.confidenceBar}`,
    ],
  };
}

/**
 * One finding, dressed as an evidence-graph claim with its provenance attached.
 *
 * The `src` block is the shape `lib/venue-imagery.mjs` signs geometry with and
 * `lib/imagery-ledger.mjs` reads coverage from, so a row that reaches a bundle
 * is visible to the `imagery_ledger` certification gate rather than invisible
 * to it. `source` stays the evidence weight of the instrument; `src.by` stays
 * the evidence class of the pixels. They are different questions.
 */
export function claimFromFinding(finding, pass, provenance = {}) {
  const laneId = upperLane(pass?.lane);
  const at = finding?.at;
  return {
    source: pass?.source ?? null,
    kind: finding?.kind ?? null,
    at:
      Number.isFinite(at?.lat) && Number.isFinite(at?.lng)
        ? { lat: at.lat, lng: at.lng }
        : null,
    date: provenance?.captured ?? null,
    lane: laneId,
    pass: pass?.id ?? null,
    target: finding?.target ?? null,
    label: finding?.label ?? null,
    category: finding?.category ?? null,
    confidence: Number.isFinite(finding?.confidence) ? finding.confidence : null,
    note:
      `lane ${laneId ?? '?'} pass ${pass?.id ?? '(unnamed)'}: `
      + `${finding?.label || finding?.kind || 'a feature'}`,
    src: {
      by: provenance?.by ?? 'aerial',
      tile: provenance?.tile ?? null,
      source: provenance?.source ?? null,
    },
  };
}

const meetsBar = (claim, pass) =>
  Number.isFinite(pass?.confidenceBar)
  && Number.isFinite(claim?.confidence)
  && claim.confidence >= pass.confidenceBar;

/**
 * Route one pass's findings: which may be written as truth, which enter the
 * graph as claims, and which are refused before either.
 *
 * Refusal comes first and it is provenance-shaped, not quality-shaped. A
 * finding whose tile is missing from the ledger, or whose tile is served
 * through a channel ADR-0020 clause 2 rejects, is refused in the ledger's own
 * words — this module does not re-implement that judgement, it asks for it.
 *
 * @param {{pass: object, findings?: object[], provenance?: object, ledger?: object}} opts
 *        `ledger` is passed through to `claimCoverage`; leaving it undefined
 *        reads the committed ledger from disk.
 */
export function claimsFromPass({ pass, findings = [], provenance = {}, ledger } = {}) {
  const verdict = passVerdict(pass);
  const out = { verdict, claims: [], truth: [], refused: [] };
  const byClass = provenance?.by ?? 'aerial';
  const classProblem = IMAGERY_EVIDENCE_CLASSES.includes(byClass)
    ? null
    : `provenance class "${byClass}" is not an imagery evidence class `
      + `(${IMAGERY_EVIDENCE_CLASSES.join(', ')}) — this lane derives from pixels or not at all`;

  for (const finding of Array.isArray(findings) ? findings : []) {
    const claim = claimFromFinding(finding, pass, provenance);
    const label = claim.label || claim.kind || 'claim';
    const problems = [];
    if (verdict.route === 'refused') problems.push(...verdict.reasons);
    if (classProblem) problems.push(`${label}: ${classProblem}`);
    if (!CLAIM_KINDS.includes(claim.kind)) {
      problems.push(
        `${label}: "${claim.kind}" is not something imagery reads `
        + `(${CLAIM_KINDS.join(', ')})`,
      );
    }
    if (!claim.at) problems.push(`${label}: no position`);
    if (!problems.length) {
      const cover = claimCoverage(claim, ledger);
      if (!cover.ok) problems.push(...cover.problems);
    }
    if (problems.length) {
      out.refused.push({ claim, problems });
      continue;
    }
    if (verdict.route === 'truth' && meetsBar(claim, pass)) out.truth.push(claim);
    else out.claims.push(claim);
  }
  return out;
}

/** The OSM Place a claim is talking about, or null when it is talking about
 *  something OSM does not have.
 *
 *  Identity by key or by name is established independently of distance, so a
 *  Place OSM puts two hundred metres away is still that Place, disputed. The
 *  name path reuses ship-gaps' own rule — exactly one Place may carry the
 *  title, an ambiguous one is skipped rather than forked — because forking a
 *  dispute across two same-named rides invents the very thing this lane exists
 *  to avoid. Identity by proximity is the only path capped at MATCH_METRES,
 *  and it needs the finding to have said what category it saw. */
function counterpartFor(claim, pois) {
  const list = Array.isArray(pois) ? pois : [];
  const keyOf = (p) => p?.i || p?.id || null;

  if (claim.target) {
    const byKey = list.find((p) => keyOf(p) === claim.target);
    return byKey ? { poi: byKey, matchedBy: 'target' } : null;
  }
  if (claim.label) {
    const key = resolveGapTarget(list, claim.label);
    const byName = key ? list.find((p) => keyOf(p) === key) : null;
    if (byName) return { poi: byName, matchedBy: 'name' };
  }
  if (!claim.category) return null;

  let best = null;
  for (const poi of list) {
    if (poi?.c !== claim.category) continue;
    if (!Number.isFinite(poi?.lat) || !Number.isFinite(poi?.lng)) continue;
    const metres = metresBetween(claim.at, poi);
    if (metres > MATCH_METRES) continue;
    if (!best || metres < best.metres) best = { poi, matchedBy: 'nearest', metres };
  }
  return best;
}

const disputeRow = (claim, { kind, target, metres, truthAt, matchedBy }) => ({
  id: `${kind}:${target ?? `${claim.at.lat.toFixed(6)},${claim.at.lng.toFixed(6)}`}`,
  kind,
  target: target ?? null,
  metres: Number(metres.toFixed(1)),
  matchedBy,
  imageryAt: { ...claim.at },
  truthAt: truthAt ? { ...truthAt } : null,
  lane: claim.lane ?? null,
  pass: claim.pass ?? null,
  source: claim.source ?? null,
  tile: claim.src?.tile ?? null,
  label: claim.label ?? null,
  note:
    'OSM stays canonical (ADR-0020 clause 5). Recorded for a steward to weigh; nothing was moved, '
    + 'and this never reaches a guest (see OWNER_DECISION_C).',
});

/**
 * Sort a lane's claims into the three things ADR-0020 clause 5 distinguishes:
 * imagery **agrees** with OSM, imagery **adds** what OSM lacks, imagery
 * **disputes** where OSM already says something else.
 *
 * Reads truth, writes none. Nothing here mutates `pois` or `map`, and no fused
 * midpoint is computed: this is not an arbitration between two sources by
 * weight — clause 5 makes OSM canonical whatever outranks what — it is the
 * recording of a disagreement for a person.
 */
export function disputesAgainstTruth({ claims = [], pois = [], map = null } = {}) {
  const out = { disputes: [], agrees: [], adds: [], unplaced: [] };

  for (const claim of Array.isArray(claims) ? claims : []) {
    if (!Number.isFinite(claim?.at?.lat) || !Number.isFinite(claim?.at?.lng)) {
      out.unplaced.push(claim);
      continue;
    }

    if (claim.kind === 'path_edge') {
      const metres = metresToWalkable(map, claim.at.lat, claim.at.lng);
      if (metres == null || !Number.isFinite(metres) || metres > MATCH_METRES) {
        out.adds.push(claim);
      } else if (metres <= AGREE_METRES) {
        out.agrees.push(claim);
      } else {
        out.disputes.push(
          disputeRow(claim, {
            kind: 'path_position',
            target: null,
            metres,
            truthAt: null,
            matchedBy: 'walkable',
          }),
        );
      }
      continue;
    }

    const counterpart = counterpartFor(claim, pois);
    if (!counterpart) {
      out.adds.push(claim);
      continue;
    }
    const { poi, matchedBy } = counterpart;
    const metres = metresBetween(claim.at, poi);
    if (metres <= AGREE_METRES) {
      out.agrees.push(claim);
      continue;
    }
    out.disputes.push(
      disputeRow(claim, {
        kind: 'place_position',
        target: poi.i || poi.id || null,
        metres,
        truthAt: { lat: poi.lat, lng: poi.lng },
        matchedBy,
      }),
    );
  }

  return out;
}

/**
 * The one artefact this lane produces for a person.
 *
 * Deliberately not a Gap document and deliberately not shaped like one: it
 * carries lane verdicts (why each pass could or could not write truth), the
 * disputes a steward has to weigh, and counts. It has no `gaps` field for a
 * future edit to fill in, and it says who it is for so that a reader who finds
 * it in a bundle knows immediately that something has gone wrong.
 */
export function imageryDisputeRecord({
  venueId = null,
  verdicts = [],
  claims = [],
  disputes = [],
  refused = [],
  asOf = null,
} = {}) {
  const byKind = {};
  for (const dispute of disputes) {
    byKind[dispute.kind] = (byKind[dispute.kind] || 0) + 1;
  }
  const record = {
    version: 1,
    venue: venueId,
    audience: 'maintainer',
    shipped: false,
    decision: OWNER_DECISION_C,
    lanes: verdicts.map((v) => ({
      pass: v.pass ?? null,
      lane: v.lane ?? null,
      route: v.route,
      reasons: [...(v.reasons || [])],
    })),
    summary: {
      claims: claims.length,
      disputes: disputes.length,
      refused: refused.length,
      byKind,
    },
    disputes: disputes.map((d) => ({ ...d })),
  };
  if (asOf) record.asOf = asOf;
  return record;
}

/**
 * Where the record lives: beside the venue's other builder sidecars, under the
 * builder package's own `data/venues/`. Never under `VENUE_DIR` — that
 * directory is the bundle a phone downloads.
 */
export function disputeRecordFile(venueId, { dir = OVERRIDE_DIR } = {}) {
  return path.join(dir, String(venueId ?? ''), 'imagery-disputes.json');
}

/** Write the record to its sidecar. Returns the file it wrote. */
export function writeDisputeRecord(record, { dir = OVERRIDE_DIR } = {}) {
  const file = disputeRecordFile(record?.venue, { dir });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Everything wrong with the wall between this lane and `*.gaps.json`. Empty
 * means the wall holds.
 *
 * The parameters exist so the suite can push each check over on its own; the
 * defaults are the real thing, and every default is a live cross-module read
 * rather than a copy — `gapTypes` is ship-gaps' own array, `shippedDir` is the
 * directory venue-io writes bundles into, and the record's path comes from
 * `disputeRecordFile` rather than from a literal restated here.
 *
 * @param {{gaps?: object|object[], record?: object|null, gapTypes?: readonly string[],
 *          disputeKinds?: readonly string[], shippedDir?: string}} opts
 * @returns {string[]}
 */
export function gapWallProblems({
  gaps = null,
  record = null,
  gapTypes = SHIPPED_GAP_TYPES,
  disputeKinds = DISPUTE_KINDS,
  shippedDir = VENUE_DIR,
} = {}) {
  const problems = [];
  const allowed = [...gapTypes];

  if (
    allowed.length !== FROZEN_GAP_TYPES.length
    || allowed.some((type, i) => type !== FROZEN_GAP_TYPES[i])
  ) {
    problems.push(
      `shipped Gap types are no longer the frozen seven: [${allowed.join(', ')}] ≠ `
      + `[${FROZEN_GAP_TYPES.join(', ')}] — ${OWNER_DECISION_C}`,
    );
  }

  for (const kind of disputeKinds) {
    if (!allowed.includes(kind) && !FROZEN_GAP_TYPES.includes(kind)) continue;
    problems.push(
      `dispute kind "${kind}" is also a shipped Gap type — a disagreement between two sources is `
      + 'not a hole a guest can fill by standing somewhere',
    );
  }

  if (record) {
    const file = disputeRecordFile(record.venue);
    if (!isInside(file, OVERRIDE_DIR)) {
      problems.push(`the maintainer record for ${record.venue} would be written outside the builder's data directory: ${file}`);
    }
    if (isInside(file, shippedDir)) {
      problems.push(
        `the maintainer record for ${record.venue} would be written to ${file}, inside the shipped `
        + 'venue directory — the decision keeps it builder-side',
      );
    }
    if (record.audience !== 'maintainer') {
      problems.push(`the maintainer record declares audience "${record.audience}" — it is for a maintainer, never a guest`);
    }
    if (record.shipped) problems.push('the maintainer record declares that it ships');
    if ('gaps' in record) {
      problems.push('the maintainer record carries a "gaps" field — a dispute record must not mint shipped Gaps');
    }
  }

  const rows = Array.isArray(gaps) ? gaps : Array.isArray(gaps?.gaps) ? gaps.gaps : [];
  rows.forEach((row, i) => {
    const where = `${gaps?.venue ?? 'gaps'}[${i}]`;
    if (!allowed.includes(row?.type)) {
      problems.push(`${where}: type "${row?.type}" is not one of the shipped Gap types`);
    }
    const extra = Object.keys(row || {}).filter((key) => key !== 'type' && key !== 'target');
    if (extra.length) {
      problems.push(
        `${where}: carries ${extra.join(', ')} beyond {type, target} — ADR-0009 keeps the wire `
        + 'atomic, and a dispute must not ride into the bundle on a Gap row',
      );
    }
  });

  return problems;
}
