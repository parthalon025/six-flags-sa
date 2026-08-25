/**
 * validate-ui origin-loss classification — when to abort the suite queue.
 *
 * Interface:
 *   classifySuiteFailure(message)
 *   shouldAbortQueueOnFailure(classification)
 */
import { isOriginUnreachable } from '../../../scripts/lib/app-origin.mjs';

export function classifySuiteFailure(message) {
  if (isOriginUnreachable(message)) return 'origin-lost';
  return 'suite-failed';
}

export function shouldAbortQueueOnFailure(classification) {
  return classification === 'origin-lost';
}

/** After a suite red, only keep going when the origin still answers. */
export function shouldAbortAfterSuiteFailure({ suiteError, originAlive }) {
  if (!originAlive) return true;
  return shouldAbortQueueOnFailure(classifySuiteFailure(suiteError));
}
