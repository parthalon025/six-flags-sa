/**
 * The capture record: the twin's one piece of state, and its freshness key.
 *
 * `npm run design:twin` boots the real app, drives it, and writes everything it
 * observed here. Everything downstream — the pages, the push plan, the
 * staleness check — reads this file. Nothing downstream opens a browser, so
 * `design:build` and `design:check` stay pure, fast and runnable in CI on a box
 * with no server.
 *
 * The record is WRITTEN ONLY BY THE BROWSER. That is the rule that makes the
 * twin a twin: no copy string, place name, count or party code in it was typed
 * by anyone — each one was read off a screen the app actually painted. If a
 * value is not here, the twin says the state was not reached rather than
 * inventing something that would look right.
 *
 * Interface:
 *   RECORD_DIR / RECORD_FILE / SHOT_DIR        where it lives
 *   readRecord()            → record | null
 *   writeRecord(record)     → void
 *   fingerprint(paths)      → { [relPath]: sha256 }
 *   staleness(record)       → { stale, changed, missing, advisory }
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, posix } from 'node:path';
import { root } from '../design-bundle/sources.mjs';

export const RECORD_DIR = 'docs/design/twin-capture';
export const RECORD_FILE = posix.join(RECORD_DIR, 'capture.json');
export const SHOT_DIR = posix.join(RECORD_DIR, 'shots');

/** Bumped when the record's shape changes in a way older records cannot satisfy. */
export const RECORD_VERSION = 1;

export function readRecord() {
  const abs = join(root, RECORD_FILE);
  if (!existsSync(abs)) return null;
  const record = JSON.parse(readFileSync(abs, 'utf8'));
  return record.recordVersion === RECORD_VERSION ? record : null;
}

export function writeRecord(record) {
  mkdirSync(join(root, RECORD_DIR), { recursive: true });
  writeFileSync(join(root, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`);
}

/** Drop shot files no longer named by the record, so a renamed screen leaves nothing behind. */
export function sweepShots(record) {
  const dir = join(root, SHOT_DIR);
  if (!existsSync(dir)) return [];
  const kept = new Set(
    record.screens.flatMap((s) => [
      ...Object.values(s.shots).map((v) => v.file),
      /* Every Profile shot is kept on disk, shown or not: the shots directory
         is INPUT, and `profileShown` is a judgement that may be revised. A
         sweep that threw away the shots the current rule rejects would make
         `design:twin resolve` unable to promote one back, and the only way to
         change the rule would be to re-photograph the app. Only the shown ones
         are copied into the push root. */
      ...(s.profile ? [s.profile.shot.file] : []),
    ]),
  );
  const dropped = [];
  for (const name of readdirSync(dir)) {
    if (kept.has(name)) continue;
    rmSync(join(dir, name));
    dropped.push(name);
  }
  return dropped;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** sha256 of each path, relative to the repo root. A path that is gone gets `null`. */
export function fingerprint(paths) {
  const out = {};
  for (const rel of [...new Set(paths)].sort()) {
    const abs = join(root, rel);
    out[rel] = existsSync(abs) ? sha256(readFileSync(abs)) : null;
  }
  return out;
}

/* ------------------------------------------------------------------
   What "stale" means for a screenshot
   ------------------------------------------------------------------ */

/**
 * Staleness is keyed on the capture's INPUTS, never on its output bytes.
 *
 * Hashing the PNG/WebP would be worse than useless here. The app draws a live
 * clock, live weather, a GPS pulse that breathes, a map whose labels are placed
 * by a layout pass with ties broken by float order, and a palette that resolves
 * `auto` from the time of day. Two captures of an unchanged app differ in
 * thousands of pixels. A check keyed on the image would fail every run, and a
 * check that fails every run is turned off within a week — which is exactly how
 * the last twin came to be trusted while being wrong.
 *
 * So the question is not "do the pixels match" but "could this screen still
 * look and behave the way this page says it does". That is a question about the
 * files the page's claims were read out of:
 *
 *   TIER 1 — FAILS. Every file the twin renders an annotation from: the
 *   components resolved as owning each screen, the stylesheet the token list
 *   was measured against, and the app shell. If one of these changed, the
 *   twin's own statements about that screen may now be false, and a false
 *   statement is the failure mode this whole project exists to stop.
 *
 *   TIER 2 — ADVISORY. The set of component FILENAMES under the app. A file
 *   appearing or disappearing here might mean a new screen the twin has never
 *   photographed — or might mean nothing at all, because a component on disk
 *   and mounted nowhere is not a screen (`GlanceRail.jsx` is exactly that). It
 *   is reported, never thrown: a check that fires on work it cannot judge is
 *   the same crying-wolf failure in a different coat.
 *
 * This is honest about what it cannot see: a change to a file no screen was
 * attributed to — a `lib/` module, a component the resolver did not rank high
 * enough — passes tier 1 silently. The mitigation is that the attribution is
 * itself derived and recorded, so what the check covers is visible on the page
 * rather than assumed.
 */
export function staleness(record) {
  const changed = [];
  const missing = [];
  const now = fingerprint(Object.keys(record.inputs));
  for (const [rel, was] of Object.entries(record.inputs)) {
    if (now[rel] === null) missing.push(rel);
    else if (now[rel] !== was) changed.push(rel);
  }

  const advisory = [];
  const listed = new Set(record.componentIndex || []);
  const present = new Set(componentIndex());
  for (const f of present) if (!listed.has(f)) advisory.push(`${f} is new since the capture`);
  for (const f of listed) if (!present.has(f)) advisory.push(`${f} is gone since the capture`);

  return { stale: changed.length > 0 || missing.length > 0, changed, missing, advisory };
}

/** Every component filename the app has right now — the tier-2 advisory key. */
export function componentIndex() {
  const dir = join(root, 'apps/party-tracker/components');
  return readdirSync(dir)
    .filter((n) => n.endsWith('.jsx'))
    .sort();
}
