/**
 * Vercel Hobby deploy budget — shared constants for ignore logic and agent rules.
 *
 * 100 deploys/day on the account. Twenty-five are reserved for explicit user
 * directive (preview or forced build). Automation (production merges with app
 * changes) may use the remaining seventy-five.
 */
export const DAILY_DEPLOY_CAP = 100;
export const USER_DEPLOY_RESERVE = 25;
export const AUTOMATION_DEPLOY_BUDGET = DAILY_DEPLOY_CAP - USER_DEPLOY_RESERVE;

/** Commit subject marker — only the user should add this. */
export const USER_BUILD_SUBJECT = /\[vercel build\]/i;
export const SKIP_BUILD_SUBJECT = /\[skip vercel\]/i;

/** Vercel project env the user sets in the dashboard for a one-off deploy. */
export const USER_BUILD_ENV = 'VERCEL_USER_BUILD';

export function isPreviewEnv(env) {
  return env === 'preview' || env === 'development';
}

export function commitSubjectWantsBuild(subject) {
  return USER_BUILD_SUBJECT.test(String(subject || ''));
}

export function commitSubjectWantsSkip(subject) {
  return SKIP_BUILD_SUBJECT.test(String(subject || ''));
}

/** True when the user explicitly authorized this deploy (preview / discretionary). */
export function isUserDirectedBuild({ subject, userBuild = process.env[USER_BUILD_ENV] } = {}) {
  if (userBuild === '1') return true;
  return commitSubjectWantsBuild(subject);
}
