/**
 * How alike two attraction names read — the builder's one name-matching primitive.
 *
 * A leaf on purpose. `venue-judge.mjs` used to hold this and also reads the
 * ledger, so anything wanting to compare two lists of ride names inherited a
 * path back to `venue-io.mjs`. That is what made a shipped-gaps caller of the
 * inventory comparison a dependency cycle (#29); the comparison needs the
 * similarity score and nothing else, so the score lives here, importing only
 * the normalisation the builder already joins on.
 *
 * Interface:
 *   nameSimilarity(a, b)                 → 0-1
 *   pairSuggestions(left, right, opts)   → best pairings above a floor
 */

import { normaliseRideName } from '@party-tracker/shared/mapSymbols.js';

const WORD = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Edit distance without pulling in a dependency. */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * How alike two attraction names read, 0–1.
 *
 * Uses the same normalisation the builder joins on, then token overlap and
 * character distance as a tie-breaker for near-misses like "Tiki River Run"
 * versus "Tiki River Run (Right Slide)".
 */
export function nameSimilarity(a, b) {
  const na = normaliseRideName(a);
  const nb = normaliseRideName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;

  const wa = new Set(WORD(na));
  const wb = new Set(WORD(nb));
  const union = new Set([...wa, ...wb]);
  const inter = [...wa].filter((w) => wb.has(w)).length;
  const jaccard = union.size ? inter / union.size : 0;

  const maxLen = Math.max(na.length, nb.length);
  const edit = 1 - levenshtein(na, nb) / maxLen;
  return Math.max(jaccard * 0.85, edit * 0.75);
}

/**
 * Best name pairings between two lists, above a floor.
 *
 * @returns {{ left, right, score }[]} sorted strongest first, one right per left
 */
export function pairSuggestions(left, right, { floor = 0.55, limit = 12 } = {}) {
  const scored = [];
  for (const l of left) {
    for (const r of right) {
      const score = nameSimilarity(l, r);
      if (score >= floor) scored.push({ left: l, right: r, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const usedRight = new Set();
  const out = [];
  for (const row of scored) {
    if (usedRight.has(row.right)) continue;
    usedRight.add(row.right);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}
