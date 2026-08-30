/**
 * ADR numbering — one number, one ADR.
 *
 * A citation in this repo is a number: "Depends on: ADR-0012", "do not
 * relitigate ADR-0010". That only resolves while a number names exactly one
 * file. Four numbers had drifted onto two unrelated ADRs each (0008, 0010,
 * 0011, 0026) before anyone noticed, because nothing was watching filenames.
 *
 * The fix the repo chose is a **letter suffix** rather than a hard renumber:
 * the earlier filing keeps the bare number, the later one takes `NNNNa`. That
 * keeps every existing citation of the earlier ADR correct, and it means the
 * check below judges the *full* id — `0008` and `0008a` are two ADRs, two
 * files literally named `0008-*.md` are one number claimed twice.
 *
 * Pure: it takes filenames and returns a verdict, so a caller can hand it a
 * directory that never existed. `scripts/ci/adr-numbers.mjs` is the CLI.
 *
 * Interface:
 *   parseAdrFilename(file)
 *   adrDriftReport(files)
 *   formatAdrDrift(report)
 *   IGNORED_ADR_FILES
 */

/** Files that may sit in docs/adr without being an ADR. */
export const IGNORED_ADR_FILES = ['README.md', 'index.md', 'template.md'];

/**
 * `NNNN-slug.md`, or `NNNNa-slug.md` for a later filing on a taken number.
 * One letter, not a run of them: the second collision on a number takes `b`,
 * so `0008aa` is a typo rather than a third ADR, and reads as one here.
 */
const ADR_FILENAME = /^(\d{4})([a-z]?)-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/**
 * The ADR a filename claims, or null when the file is not an ADR filename.
 *
 * @param {string} file basename, e.g. `0008a-databricks-back-office.md`
 * @returns {{file: string, number: string, letter: string, id: string, slug: string} | null}
 */
export function parseAdrFilename(file) {
  const name = String(file);
  const m = ADR_FILENAME.exec(name);
  if (!m) return null;
  const [, number, letter, slug] = m;
  return { file: name, number, letter, id: `${number}${letter}`, slug };
}

/**
 * Verdict over one directory listing.
 *
 * @param {string[]} files basenames of `docs/adr`
 * @returns {{ok: boolean, collisions: {id: string, files: string[]}[], malformed: string[]}}
 */
export function adrDriftReport(files = []) {
  const candidates = files
    .map((f) => String(f))
    .filter((f) => f.endsWith('.md'))
    .filter((f) => !IGNORED_ADR_FILES.includes(f));

  const byId = new Map();
  const malformed = [];
  for (const file of candidates) {
    const adr = parseAdrFilename(file);
    if (!adr) {
      malformed.push(file);
      continue;
    }
    if (!byId.has(adr.id)) byId.set(adr.id, []);
    byId.get(adr.id).push(file);
  }

  const collisions = [...byId.entries()]
    .filter(([, claimants]) => claimants.length > 1)
    .map(([id, claimants]) => ({ id, files: [...claimants].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));

  malformed.sort();
  return { ok: collisions.length === 0 && malformed.length === 0, collisions, malformed };
}

/** The failure message — empty string when there is nothing to say. */
export function formatAdrDrift(report) {
  if (!report || report.ok) return '';
  const lines = [];

  if (report.collisions.length) {
    lines.push(
      `docs/adr: ${report.collisions.length} ADR number(s) claimed by more than one file.`,
      'A citation like "ADR-0010" cannot resolve while two ADRs answer to it.',
      '',
    );
    for (const { id, files } of report.collisions) {
      lines.push(`  ADR-${id}`);
      for (const file of files) lines.push(`    docs/adr/${file}`);
    }
    const [{ id }] = report.collisions;
    lines.push(
      '',
      'Fix: the ADR filed first keeps the bare number; the later filing takes a',
      `letter suffix — docs/adr/${id}-<slug>.md becomes docs/adr/${id}a-<slug>.md.`,
      "Read each file's Date/Status header (or git log) to see which came later,",
      "update the renamed file's own title header, and repoint the citations that",
      'meant that file — citations of the ADR you left un-renamed stay as they are.',
    );
  }

  if (report.malformed.length) {
    if (lines.length) lines.push('');
    lines.push(
      'docs/adr: file(s) with no ADR number — nothing can cite them:',
      ...report.malformed.map((file) => `  docs/adr/${file}`),
      'Name them NNNN-slug.md (or NNNNa-slug.md), or move them out of docs/adr.',
    );
  }

  return lines.join('\n');
}
