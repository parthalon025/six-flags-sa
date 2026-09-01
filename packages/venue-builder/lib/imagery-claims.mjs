/**
 * Train I — extraction lanes and the claims / dispute / truth wall.
 *
 * ADR-0020 clauses 3 and 5: imagery may add what OSM lacks and, where it
 * contradicts OSM, raise a dispute for steward review. It never silently moves
 * geometry, and — the owner's answer of 2026-08-22 — it never asks a guest
 * about it either. A dispute leaves this module as a maintainer record
 * (imagery-disputes.mjs), not as a Gap; there is no third return channel.
 *
 * Three lanes, one router:
 *   deterministic — may write truth only when the pass proves itself identical
 *   model         — evidence claims only
 *   agent         — evidence claims only
 *
 * Three things gate the deterministic lane, and none of them is a flag it sets
 * about itself. The pass has to be enrolled in `CI_PROVEN_PASSES`, which is
 * empty by construction — ADR-0020 clause 3 admits truth "only when that exact
 * invocation is CI-proven". Its output digests have to agree across at least
 * two runs (`determinismProof`), which is what that CI proof is *made of*
 * rather than a substitute for it: an id on a list is a claim about a check,
 * and the digests are the check. And it must not route through an OpenCV
 * primitive whose RNG the caller cannot pin without declaring the mitigations
 * for it (`RNG_TAINTED_PRIMITIVES`).
 *
 * A claim that reaches the evidence graph is `src`-signed with the tile it was
 * read off, so imagery-ledger.mjs can see it. `claimsFromPass` refuses on that
 * provenance up front — unledgered tile, a channel clause 2 rejects, a class
 * that is not imagery at all — rather than letting coverage be asked after the
 * fact about a row nothing can trace back to a pixel.
 */

import { metresBetween } from './evidence.mjs';
import { metresToWalkable, resolveGapTarget } from './ship-gaps.mjs';
import { claimCoverage, IMAGERY_EVIDENCE_CLASSES } from './imagery-ledger.mjs';
import { disputeRow } from './imagery-disputes.mjs';

export const EXTRACTION_LANES = Object.freeze(['deterministic', 'model', 'agent']);

/** What a routed extraction may become. `dispute` is builder-side only. */
export const WRITE_MODES = Object.freeze(['truth', 'claim', 'dispute']);

/** Metres of centreline disagreement that count as a dispute, not noise. */
export const DISPUTE_TOLERANCE_M = 8;

/* How many tolerances away a thing stops being the same thing in the wrong
   place and becomes a different thing entirely. Past this, a proximity match
   is imagery ADDING what OSM lacks (ADR-0020 clause 5), not a dispute about a
   position — so it must never be recorded as one. Named because it scales with
   DISPUTE_TOLERANCE_M: editing the tolerance alone silently moves this cutoff
   too, and the two decide different questions. */
export const DISTINCT_FEATURE_TOLERANCES = 4;

/**
 * Pass ids CI has published byte-identical digests for.
 *
 * Empty, and empty by construction. ADR-0020 clause 3 admits a truth write
 * "only when that exact invocation is CI-proven byte-identical across
 * consecutive runs", and nothing has been CI-proven, so the truth channel is
 * shut until CI opens it. Un-enrolled is the correct state, not a gap to route
 * around: the alternative reads the proof off `extractions.json`, a builder
 * sidecar a hand can edit, which turns attestation into self-attestation.
 *
 * Enrolment is necessary and not sufficient. `determinismProof` is the other
 * conjunct and it is the substance of the attestation: the digests are what CI
 * watched, so a pass named on this list whose recorded runs disagree — or which
 * recorded one run, or none — still writes no truth. The list says which
 * invocation was watched; the digests say what the watching saw. Neither half
 * is an id standing in for a check.
 *
 * A frozen array, not a Set: Set#add still mutates after Object.freeze. */
export const CI_PROVEN_PASSES = Object.freeze([]);

/**
 * What an imagery pass is allowed to say it found — ADR-0020 clause 1's own
 * list ("tree positions, surface classes, water and path edges"), plus `place`
 * for the semantic reads the agent lane exists for.
 *
 * A closed vocabulary rather than a free-text kind, because the alternative is
 * this lane growing a `queue_wait` or a `height_requirement` — facts imagery
 * cannot see, arriving with imagery's provenance attached. `path` is spelled
 * the way the rest of the builder spells a walkway (venue-imagery.mjs feature
 * kinds, the extractions sidecar), not renamed on the way in here.
 */
export const CLAIM_KINDS = Object.freeze(['path', 'place', 'tree', 'surface', 'water_edge']);

/** The one kind OSM carries as a Place, so the one kind whose counterpart can
 *  be in the wrong position rather than merely missing. */
const PLACE_KIND = 'place';

/** Kinds OSM does not carry at all: imagery can only ever add them, so they are
 *  never measured against a walkway they have nothing to do with. */
const ADD_ONLY_KINDS = Object.freeze(['tree', 'surface', 'water_edge']);

/**
 * Deterministic-lane primitives with RNG the caller cannot pin, and what has to
 * be declared before a pass built on one may be considered for a truth write.
 *
 * These are the CV research note's `adopt:` triggers
 * (docs/research/2026-08-20-imagery-cv-research.md, the `cv2.kmeans` / GrabCut
 * and RANSAC-homography registry rows), kept as data so a pass declares its
 * mitigations and this module checks them, rather than a reviewer remembering
 * which of the traps this particular pass falls into. A fully mitigated pass
 * still has to clear `determinismProof` — the mitigations are what make the
 * two-run check meaningful, not a substitute for it.
 */
export const RNG_TAINTED_PRIMITIVES = Object.freeze({
  kmeans: Object.freeze({
    why: 'cv::theRNG() seeds the centre initialisation and the seed is not pinned per call',
    mitigations: Object.freeze(['seeded', 'single-thread', 'ipp-disabled']),
  }),
  grabcut: Object.freeze({
    why: 'initGMMs() hard-codes a KMEANS_PP_CENTERS call with no caller-visible seed control',
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

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

const normalisePrimitive = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Every RNG-tainted primitive this pass declares and has not fully mitigated.
 * Empty means nothing on the list stands between it and a truth write; the rows
 * are the reasons a maintainer can act on.
 *
 * `cv2.kmeans`, `kmeans` and `KMeans` are the same primitive — a declaration is
 * matched on its bare name, so a pass cannot slip past the list by spelling it
 * the way its own library does.
 */
export function unmitigatedPrimitives(pass) {
  const declared = Array.isArray(pass?.primitives) ? pass.primitives : [];
  const met = new Set((Array.isArray(pass?.mitigations) ? pass.mitigations : []).map(String));
  const found = new Map();
  for (const raw of declared) {
    const norm = normalisePrimitive(raw);
    for (const [key, row] of Object.entries(RNG_TAINTED_PRIMITIVES)) {
      if (!norm.includes(key) || found.has(key)) continue;
      const unmet = row.mitigations.filter((m) => !met.has(m));
      if (unmet.length) {
        found.set(key, { primitive: key, declaredAs: String(raw), why: row.why, unmet });
      }
    }
  }
  return [...found.values()];
}

/**
 * Whether this pass's output has been shown to be byte-identical run to run.
 *
 * Derived from the recorded digests rather than read off a `deterministic: true`
 * flag, because a flag is a claim about a check and the digests are the check
 * (ADR-0020 clause 3). One run is not evidence of anything — it is the same
 * number twice only if you count it twice.
 */
export function determinismProof(pass) {
  const digests = (Array.isArray(pass?.determinism?.digests) ? pass.determinism.digests : [])
    .filter((d) => typeof d === 'string' && d.length > 0);
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
 * Whether this extraction's pass may write truth at all, and why not when it may
 * not. The reasons are the point: a pass that lands on `claim` says what would
 * have to change — get CI to attest the invocation, record a second run,
 * declare the mitigation — rather than leaving a maintainer to infer it from a
 * boolean.
 *
 * Every reason is collected, not the first one. A pass that is un-enrolled *and*
 * unproven should be told both, because fixing either alone changes nothing.
 */
export function truthEligibility(extraction) {
  const reasons = [];
  if (extraction?.lane !== 'deterministic') {
    reasons.push(
      `lane ${JSON.stringify(extraction?.lane ?? null)} never writes truth — evidence claims only`,
    );
  }
  if (!CI_PROVEN_PASSES.includes(extraction?.passId)) {
    reasons.push(
      `pass ${JSON.stringify(extraction?.passId ?? null)} is not CI-proven — the digests on `
      + 'this record are the builder sidecar\'s word for itself, and CI attestation is not '
      + 'self-attestation (ADR-0020 clause 3)',
    );
  }
  if (extraction?.deterministic === false) {
    reasons.push('the pass reports itself nondeterministic');
  }
  for (const tainted of unmitigatedPrimitives(extraction)) {
    reasons.push(
      `${tainted.declaredAs} is RNG-tainted (${tainted.why}); still undeclared: `
      + `${tainted.unmet.join(', ')}`,
    );
  }
  const proof = determinismProof(extraction);
  if (!proof.proven) reasons.push(`determinism unproven: ${proof.why}`);
  return { ok: reasons.length === 0, proof, reasons };
}

/** Factory ways use `{ r: [[lng,lat],…] }`; GeoJSON fixtures use coordinates. */
export function osmPathMap(map) {
  const ways = [];
  for (const feat of [...(map?.path || []), ...(map?.layers?.path || [])]) {
    const ring = feat?.r || feat?.geometry?.coordinates || feat?.c;
    if (Array.isArray(ring) && ring.length) ways.push({ r: ring });
  }
  return { path: ways };
}

/**
 * The OSM Place an extraction is talking about, or null when it is talking about
 * something OSM does not have.
 *
 * Identity by key or by name is established independently of distance, so a
 * Place OSM puts two hundred metres away is still that Place, disputed. The name
 * path reuses ship-gaps' own rule — exactly one Place may carry the title, an
 * ambiguous one is skipped rather than forked — because forking a dispute across
 * two same-named rides invents the very thing this lane exists to avoid.
 * Identity by proximity is the only path with a distance cap, and it needs the
 * extraction to have said what category it saw.
 */
function counterpartFor(extraction, pois, capM) {
  const list = Array.isArray(pois) ? pois : [];
  const keyOf = (p) => p?.i || p?.id || null;

  if (extraction.target) {
    const byKey = list.find((p) => keyOf(p) === extraction.target);
    return byKey ? { poi: byKey, matchedBy: 'target' } : null;
  }
  if (extraction.label) {
    const key = resolveGapTarget(list, extraction.label);
    const byName = key ? list.find((p) => keyOf(p) === key) : null;
    if (byName) return { poi: byName, matchedBy: 'name' };
  }
  if (!extraction.category) return null;

  let best = null;
  for (const poi of list) {
    if (poi?.c !== extraction.category) continue;
    if (!finite(poi?.lat) || !finite(poi?.lng)) continue;
    const metres = metresBetween(extraction.at, poi);
    if (metres > capM) continue;
    if (!best || metres < best.metres) best = { poi, matchedBy: 'nearest', metres };
  }
  return best;
}

/**
 * Compare one extraction against OSM truth already in the build.
 *
 * A walkway is measured against walkable geometry — point-to-segment on the
 * rings, not vertex haversine. A `place` is measured against the Place OSM
 * already carries, which is a different question: a carousel imagery reads sixty
 * metres from where OSM puts it is a position two sources disagree about, not a
 * second carousel.
 *
 * @returns {{ relation: 'adds'|'agrees'|'disputes'|'outside', deltaM?: number,
 *             target?: string|null, matchedBy?: string, truthAt?: object }}
 */
export function compareToOsm(extraction, { map, pois = [], toleranceM = DISPUTE_TOLERANCE_M } = {}) {
  const at = extraction?.at;
  if (!at || !finite(at.lat) || !finite(at.lng)) {
    return { relation: 'outside' };
  }

  if (extraction.kind === PLACE_KIND) {
    // Past the distinct-feature cutoff an OSM Place is a different Place
    // rather than the same one in the wrong spot, so a proximity match out
    // there is imagery adding what OSM lacks (clause 5), never a dispute.
    const counterpart = counterpartFor(
      extraction,
      pois,
      toleranceM * DISTINCT_FEATURE_TOLERANCES,
    );
    if (!counterpart) return { relation: 'adds' };
    const { poi, matchedBy } = counterpart;
    const d = metresBetween(at, poi);
    const shared = {
      deltaM: d,
      target: poi.i || poi.id || null,
      matchedBy,
      truthAt: { lat: poi.lat, lng: poi.lng },
    };
    if (d <= toleranceM) return { relation: 'agrees', ...shared };
    return { relation: 'disputes', ...shared };
  }

  if (ADD_ONLY_KINDS.includes(extraction.kind)) return { relation: 'adds' };

  const d = metresToWalkable(osmPathMap(map), at.lat, at.lng);
  if (d == null || !Number.isFinite(d) || d === Infinity) {
    return { relation: 'adds' };
  }
  if (d <= toleranceM) return { relation: 'agrees', deltaM: d };
  if (d > toleranceM * DISTINCT_FEATURE_TOLERANCES) return { relation: 'adds', deltaM: d };
  return { relation: 'disputes', deltaM: d };
}

function writeModeFor(extraction, relation) {
  if (relation === 'disputes') return 'dispute';
  if (relation === 'agrees') return 'claim';
  if (relation === 'adds' && truthEligibility(extraction).ok) return 'truth';
  return 'claim';
}

/**
 * One extraction, dressed as an evidence-graph claim with its provenance
 * attached.
 *
 * The `src` block is the shape lib/venue-imagery.mjs signs geometry with and
 * lib/imagery-ledger.mjs reads coverage from, so a row that reaches a bundle is
 * visible to `imagerySignedFeatures` and to the `imagery_ledger` certification
 * gate rather than invisible to both. The extraction's own `source` stays the
 * evidence weight of the instrument; `src.by` is the evidence class of the
 * pixels. They are different questions.
 */
export function claimFromFinding(finding, provenance = {}) {
  const at = finding?.at;
  const src = finding?.src?.by ? { ...finding.src } : {};
  if (provenance?.by) src.by = provenance.by;
  if (provenance?.source) src.source = provenance.source;
  if (provenance?.tile) src.tile = provenance.tile;
  return {
    ...finding,
    at: finite(at?.lat) && finite(at?.lng) ? { lat: at.lat, lng: at.lng } : null,
    src: { by: 'aerial', source: null, ...src },
  };
}

/**
 * Turn one pass's findings into signed claims, refusing on provenance before
 * anything is routed.
 *
 * Refusal is provenance-shaped, not quality-shaped. A finding whose tile is
 * missing from the ledger, or whose tile arrived through a channel ADR-0020
 * clause 2 rejects, is refused in the ledger's own words — this module does not
 * re-implement that judgement, it asks for it. A finding whose `src.by` is not
 * an imagery class is refused before that: this lane derives from pixels or not
 * at all.
 *
 * Survivors go through the same router as everything else, so a claim cannot
 * enter the graph by a path the dispute rules never saw — and CLAIM_KINDS is
 * enforced there rather than a second time here, because the sidecar the router
 * reads is hand-editable and a vocabulary checked in two places is a vocabulary
 * that eventually differs between them. The router's refusals are merged into
 * this call's own `refused`.
 *
 * @param {{pass?: object, findings?: object[], provenance?: object, ledger?: object,
 *          map?: object, pois?: object[], toleranceM?: number}} opts
 *        `ledger` is passed through to `claimCoverage`; leaving it undefined
 *        reads the committed ledger from disk.
 */
export function claimsFromPass({
  pass = {},
  findings = [],
  provenance = {},
  ledger,
  map,
  pois = [],
  toleranceM = DISPUTE_TOLERANCE_M,
} = {}) {
  const eligibility = truthEligibility(pass);
  const refused = [];
  const routable = [];

  for (const finding of Array.isArray(findings) ? findings : []) {
    // The pass's own fields — lane, digests, primitives — ride onto every one of
    // its findings, because the write gate is a fact about the invocation and
    // the router only ever sees a row.
    const claim = claimFromFinding({ ...pass, ...finding }, provenance);
    const label = claim.label || claim.kind || 'claim';
    const problems = [];
    if (!IMAGERY_EVIDENCE_CLASSES.includes(claim.src.by)) {
      problems.push(
        `${label}: provenance class "${claim.src.by}" is not an imagery evidence class `
        + `(${IMAGERY_EVIDENCE_CLASSES.join(', ')}) — this lane derives from pixels or not at all`,
      );
    }
    if (!claim.at) problems.push(`${label}: no position`);
    if (!problems.length) {
      const cover = claimCoverage(claim, ledger);
      if (!cover.ok) problems.push(...cover.problems);
    }
    if (problems.length) refused.push({ claim, problems });
    else routable.push(claim);
  }

  const routed = routeImageryExtractions(routable, { map, pois, toleranceM });
  return { eligibility, ...routed, refused: [...refused, ...routed.refused] };
}

/**
 * Route extractions under OSM-canonical rules.
 *
 * There is no `gaps` key. A disputed extraction produces a `disputes` row for
 * the builder-side record and a dissenting claim for the evidence graph — the
 * two audiences that are supposed to see it — and nothing a phone can fetch.
 *
 * An extraction whose `kind` is outside CLAIM_KINDS is refused here rather than
 * routed: a vocabulary this lane cannot read is not evidence about anything, and
 * it must not reach a maintainer's record wearing imagery's provenance.
 *
 * @returns {{ truth: object[], claims: object[], disputes: object[], refused: object[] }}
 */
export function routeImageryExtractions(extractions, ctx = {}) {
  const truth = [];
  const claims = [];
  const disputes = [];
  const refused = [];
  for (const extraction of extractions || []) {
    if (!CLAIM_KINDS.includes(extraction?.kind)) {
      refused.push({
        claim: extraction,
        problems: [
          `"${extraction?.kind}" is not something imagery reads (${CLAIM_KINDS.join(', ')})`,
        ],
      });
      continue;
    }
    const comparison = compareToOsm(extraction, ctx);
    const writeMode = writeModeFor(extraction, comparison.relation);
    // Signed only where provenance was actually declared: stamping `aerial` on
    // an extraction that names no imagery would forge the very block the ledger
    // gate reads.
    const signed = extraction.src || ctx.provenance
      ? claimFromFinding(extraction, ctx.provenance)
      : extraction;
    const row = { ...signed, comparison, writeMode };
    if (writeMode === 'truth') truth.push(row);
    else if (writeMode === 'dispute') {
      const place = comparison.matchedBy != null;
      disputes.push(disputeRow({
        kind: place ? 'place_disputed' : 'path_disputed',
        target: comparison.target ?? null,
        note: place ? 'place position disputed' : 'path position disputed',
        extraction: row,
      }));
      claims.push({ ...row, dissent: true });
    } else claims.push(row);
  }
  return { truth, claims, disputes, refused };
}

/**
 * Run configured extraction passes and route the results.
 * Passes are injected so a test can exercise the wall without a raster.
 */
export function runImageryClaims(venueId, {
  map,
  pois = [],
  extractions = [],
  toleranceM = DISPUTE_TOLERANCE_M,
} = {}) {
  return {
    venue: venueId,
    ...routeImageryExtractions(extractions, { map, pois, toleranceM }),
  };
}
