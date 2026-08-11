/**
 * Draft PR shipping for batch-built venues (Wave 4).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { certifyVenue, renderCertificationMarkdown } from './venue-certify.mjs';
import { MONO_ROOT } from '../src/paths.mjs';

export function openVenueDraftPr(venueId, { runId = Date.now(), baseBranch = 'main' } = {}) {
  const cert = certifyVenue(venueId, { write: true });
  const branch = `venue/${venueId}-${runId}`;
  const title = cert.certified
    ? `Add ${venueId} — certified offline twin`
    : `Add ${venueId} — needs certification review`;

  const bodyParts = [
    `Built by the unified venue pipeline.`,
    '',
    renderCertificationMarkdown(cert),
  ];
  if (cert.ask) {
    bodyParts.push('', '## Ask brief', '', '```json', JSON.stringify(cert.ask, null, 2), '```');
  }
  const bodyFile = path.join(MONO_ROOT, '.venue-pr-body.md');
  writeFileSync(bodyFile, bodyParts.join('\n'));

  const git = (args, opts = {}) => spawnSync('git', args, { cwd: MONO_ROOT, encoding: 'utf8', ...opts });
  git(['config', 'user.name', 'github-actions[bot]']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  git(['checkout', '-b', branch]);
  git(['add', 'apps/party-tracker/public/venues', 'apps/party-tracker/lib/venueIndex.js', 'packages/venue-builder/data/venues']);
  const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: MONO_ROOT });
  if (staged.status === 0) {
    return { ok: true, skipped: true, reason: 'nothing to commit', branch, certified: cert.certified };
  }
  git(['commit', '-m', title]);
  git(['push', '-u', 'origin', branch]);
  const pr = spawnSync(
    'gh',
    ['pr', 'create', '--draft', '--base', baseBranch, '--head', branch, '--title', title, '--body-file', bodyFile],
    { cwd: MONO_ROOT, encoding: 'utf8' },
  );
  return {
    ok: pr.status === 0,
    branch,
    certified: cert.certified,
    prUrl: (pr.stdout || '').trim(),
    error: pr.status !== 0 ? pr.stderr : null,
  };
}
