#!/bin/bash
#
# Vercel Ignored Build Step
#
# Exit 0 = Skip build (no relevant changes)
# Exit 1 = Proceed with build (app-related changes detected)
#
# Diff THIS commit against its first parent. Do not use VERCEL_GIT_PREVIOUS_SHA:
# that is often a PR preview with the same tree as the merge, so production
# would skip and the live alias would stay on a stale deploy.
#
# Production always builds for app-path changes. Previews skip agent branches,
# version-stamp-only bumps, and non-app diffs. Decision lives in
# scripts/lib/vercel-ignore.mjs.

set +e
echo "VERCEL_ENV=${VERCEL_ENV-}"
echo "VERCEL_GIT_COMMIT_REF=${VERCEL_GIT_COMMIT_REF-}"
echo "VERCEL_GIT_COMMIT_SHA=${VERCEL_GIT_COMMIT_SHA-}"
node scripts/lib/vercel-ignore.mjs
code=$?
set -e

if [ "$code" -eq 0 ]; then
  echo "Skipping build."
  exit 0
fi
if [ "$code" -eq 1 ]; then
  echo "Proceeding with build."
  exit 1
fi

echo "Ignore decision failed (exit $code) — proceeding with build."
exit 1
