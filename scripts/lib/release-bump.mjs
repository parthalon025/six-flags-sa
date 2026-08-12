/**
 * Decide whether a merge should cut an app semver, and which digit.
 */
import { releaseKindFromMessages } from '../../apps/party-tracker/lib/version.js';
import { isAppChange } from './app-paths.mjs';

export function decideBump(files, messages) {
  if (!isAppChange(files)) {
    return { skip: true, reason: 'no-app-change', kind: 'none' };
  }
  const kind = releaseKindFromMessages(messages);
  if (kind === 'none') {
    return { skip: true, reason: 'non-release-type', kind };
  }
  return { skip: false, reason: '', kind };
}
