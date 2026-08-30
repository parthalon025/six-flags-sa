#!/usr/bin/env node
/**
 * Publish the CI stamps this branch earned as a commit trailer.
 *
 *   node scripts/ci/stamp-commit.mjs [--base origin/main]
 *
 * `pre-merge-vertical` and `matt-review write` leave their stamps in local
 * cache files under `scripts/ci/`; those files are gitignored, because a
 * tracked stamp is what made every branch conflict with every other one on a
 * merge. This publishes them instead as trailers on one empty commit — see
 * scripts/lib/stamp-trailer.mjs for why a commit message is the transport that
 * cannot conflict.
 *
 * A cache written for some earlier diff is skipped, not published: it would
 * fail the freshness check anyway, and saying so here names the re-run needed
 * rather than leaving a silent "full CI will run" on the PR.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLocalCiContext,
  localCiPassPath,
  readLocalCiPass,
} from '../lib/local-ci-pass.mjs';
import {
  buildMattReviewContext,
  mattReviewPath,
  readMattReview,
} from '../lib/matt-review.mjs';
import {
  LOCAL_CI_TRAILER,
  MATT_REVIEW_TRAILER,
  publishStamps,
} from '../lib/stamp-trailer.mjs';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * A cached stamp is publishable only when it records *this* diff. `read` is
 * given no range on purpose — the cache file is the thing being published, and
 * reading a trailer here would republish a stamp that is already in history.
 */
function collectStamp({ label, path, read, diffHash, cwd, log }) {
  if (!existsSync(path)) return null;
  const stamp = read(cwd);
  if (!stamp) {
    log(`stamp-commit: ${label} cache is unreadable — skipped`);
    return null;
  }
  if (stamp.diffHash !== diffHash) {
    log(
      `stamp-commit: ${label} cache is for diff ${stamp.diffHash || 'none'}, not ${diffHash} — skipped (re-run it)`,
    );
    return null;
  }
  return stamp;
}

export function runStampCommit({ baseRef = 'origin/main', cwd = root, log = console.log } = {}) {
  const localCi = collectStamp({
    label: 'local-ci-pass',
    path: localCiPassPath(cwd),
    read: (dir) => readLocalCiPass(dir),
    diffHash: buildLocalCiContext({ baseRef, cwd }).diffHash,
    cwd,
    log,
  });
  const mattReview = collectStamp({
    label: 'matt-review',
    path: mattReviewPath(cwd),
    read: (dir) => readMattReview(dir),
    diffHash: buildMattReviewContext({ baseRef, cwd }).diffHash,
    cwd,
    log,
  });

  const stamps = { [LOCAL_CI_TRAILER]: localCi, [MATT_REVIEW_TRAILER]: mattReview };
  const sha = publishStamps({ cwd, stamps });
  if (!sha) {
    log('stamp-commit: nothing fresh to publish — run the gate, then stamp');
    return 1;
  }
  const published = [
    localCi ? `${LOCAL_CI_TRAILER} (${localCi.tag || 'no tag'})` : null,
    mattReview ? `${MATT_REVIEW_TRAILER} (${mattReview.model})` : null,
  ].filter(Boolean);
  log(`stamp-commit: published ${published.join(', ')} in ${sha.slice(0, 8)}`);
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--base');
  const baseRef = i >= 0 && argv[i + 1] ? argv[i + 1] : 'origin/main';
  process.exitCode = runStampCommit({ baseRef });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
