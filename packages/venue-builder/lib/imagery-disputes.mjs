/**
 * Disputes are a maintainer record. They never reach a guest.
 *
 * ADR-0020 clause 5 says imagery that contradicts OSM raises a dispute "for
 * steward review". ADR-0021's Open section then read that as a shipped Gap
 * type and `path_disputed` was added to SHIPPED_GAP_TYPES before the owner had
 * answered. The owner's answer, 2026-08-22, was the third option for *a
 * disputed path position*: keep it internal, never show guests. This module is
 * where that answer lives.
 *
 * It is a narrower answer than the first cut of this module assumed. The owner
 * ruled again on 2026-08-23, after `path_disputed` was unshipped: a *ride
 * evidence conflict* — two sources disagreeing about a ride feature — stays
 * visible to guests, on the existing `verify` Gap type. So `evidence_conflict`
 * is deliberately not a member of `DISPUTE_KINDS`; see the list below.
 *
 * Two things live here and nowhere else:
 *
 *   1. `DISPUTE_KINDS` — the vocabulary of "sources disagree, and the builder
 *      settles it, not a guest". Anything builder-side-only names itself here.
 *   2. `assertNoDisputeKinds` — the wall. Every shipped-Gap allowlist is run
 *      through it at module load, so re-adding a dispute kind to a guest-facing
 *      list does not ship a Gap, it fails the builder on the spot.
 *
 * Keeping the vocabulary and the wall in one place is the point: a wall that
 * only knows one spelling stops one spelling. `evidence_conflict` once shipped
 * without anyone deciding it should — it was routed onto `path_disputed`'s
 * channel months after `path_disputed` was invented, so it inherited a
 * guest-facing route nobody had argued for. It has one again now, but by an
 * owner ruling and by its own name (ship-gaps.mjs maps it to `verify`), not by
 * riding another kind's coat-tails.
 *
 * No filesystem here. The sidecar sink is injected (see `recordDisputes`), the
 * same discipline as osm-writeback.mjs: this module decides *what* is recorded,
 * venue-io decides *where*. That is also what lets the suite prove a refusal
 * without a disk.
 */

/**
 * Every way this codebase can say "sources disagree, and the builder keeps it
 * to itself".
 *
 * `path_disputed` — imagery puts a walkway somewhere OSM does not
 *                   (imagery-claims.mjs, ADR-0020 clause 5).
 * `place_disputed` — imagery reads a Place OSM already carries, tens of metres
 *                   from where OSM puts it. The same question as a disputed
 *                   path position and settled the same way: OSM stays
 *                   canonical, a steward weighs it, nothing is moved and no
 *                   guest is asked. It is deliberately *not* a ride evidence
 *                   conflict — that is two sources disagreeing about a ride
 *                   *feature*, which the owner ruled stays visible on `verify`.
 *
 * Membership is not "sources disagree"; it is "sources disagree *and no guest
 * is asked about it*". Every member is stamped `shipped: false` by
 * `disputeRow`, the sidecar says `shipped: false`, and the wall keeps the name
 * off every guest-facing allowlist. A kind that does reach a guest cannot hold
 * all three of those and must not be on this list: `evidence_conflict` is the
 * worked example. Its builder-side record is the certification brief's durable
 * seeds (quest-seeds.mjs), where it has always been, and its guest-facing route
 * is `verify` (owner ruling, 2026-08-23; ADR-0020 clause 5, ADR-0021 Open).
 *
 * A new builder-side-only kind belongs on this list. That is the whole
 * enrolment: the wall below then keeps it off every guest-facing allowlist
 * automatically.
 */
export const DISPUTE_KINDS = Object.freeze(['path_disputed', 'place_disputed']);

/** Builder-side sidecar filename. Under data/venues/<id>/, never under public/. */
export const DISPUTE_SIDECAR = 'imagery-disputes.json';

/** @param {unknown} word */
export function isDisputeKind(word) {
  return typeof word === 'string' && DISPUTE_KINDS.includes(word);
}

/**
 * The wall: no dispute kind may be spellable as a shipped Gap type.
 *
 * Throws rather than filtering. A dispute that reaches a guest is a promise
 * the product cannot keep — the guest is asked to settle something the
 * builder deliberately kept internal — so the honest failure is a loud one at
 * the seam, before any `*.gaps.json` is written.
 *
 * @param {Iterable<string>} shippedTypes a guest-facing Gap allowlist
 * @param {string} where names the allowlist in the failure
 * @returns {Iterable<string>} the same allowlist, so callers can assert inline
 */
export function assertNoDisputeKinds(shippedTypes, where = 'a shipped Gap allowlist') {
  const spelled = [...(shippedTypes || [])].filter(isDisputeKind);
  if (spelled.length) {
    throw new Error(
      `${where} spells dispute kind(s) ${spelled.join(', ')} as shipped Gap types. `
      + 'Disputes stay builder-side and never reach a guest (owner decision, 2026-08-22; '
      + 'ADR-0021 Open / Train I). Record them with recordDisputes instead.',
    );
  }
  return shippedTypes;
}

/**
 * One dispute, in the shape the maintainer record keeps.
 *
 * `kind`, not `type`: a shipped Gap row is `{ type, target }`, and giving the
 * record a different field name means a dispute cannot be dropped into the
 * gaps document by accident even if some future caller forwards the wrong
 * array. `shipped: false` is stated rather than implied so the sidecar reads
 * as a decision to a maintainer opening it, not as an oversight.
 *
 * @param {{ kind: string, target?: string | null, note?: string, extraction?: object }} row
 */
export function disputeRow({ kind, target = null, note = null, extraction = null } = {}) {
  if (!isDisputeKind(kind)) {
    throw new Error(`unknown dispute kind: ${kind}. Add it to DISPUTE_KINDS first.`);
  }
  return {
    kind,
    target: target ?? null,
    note,
    shipped: false,
    extraction,
  };
}

/**
 * The sidecar body. Empty is a legitimate answer — it means "this build found
 * nothing in dispute", which is worth recording rather than inferring from a
 * missing file.
 *
 * @param {{ venueId: string, disputes?: object[], asOf?: string }} opts
 */
export function disputesDocument({ venueId, disputes = [], asOf = null } = {}) {
  return {
    version: 1,
    venue: venueId || null,
    shipped: false,
    recordedAt: asOf,
    disputes: [...disputes],
  };
}

/**
 * Persist the maintainer record through an injected sink.
 *
 * Refuses without a sink rather than reaching for the filesystem itself: a
 * builder-side record that silently writes nowhere is how disputes get lost,
 * and a module that opens files cannot be exercised in a unit test.
 *
 * @param {string} venueId
 * @param {object[]} disputes
 * @param {{ write?: (doc: object) => void, asOf?: string }} deps
 * @returns {{ wrote: boolean, reason?: string, document?: object }}
 */
export function recordDisputes(venueId, disputes = [], { write, asOf } = {}) {
  const document = disputesDocument({ venueId, disputes, asOf });
  if (typeof write !== 'function') {
    return { wrote: false, reason: 'no write sink — the dispute record is not persisted', document };
  }
  write(document);
  return { wrote: true, document };
}
