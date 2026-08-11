#!/bin/bash
#
# Vercel Ignored Build Step
#
# Exit 0 = Skip build (no relevant changes)
# Exit 1 = Proceed with build (app-related changes detected)
#
# This script checks if the current commit includes changes to files that
# affect the deployed app. Changes to documentation, tests, build tools,
# or other non-runtime code skip the Vercel build.

set -e

echo "Checking if Vercel build is needed..."
echo "Current commit: ${VERCEL_GIT_COMMIT_SHA:-HEAD}"

# Paths that should trigger a Vercel build when changed
APP_PATHS=(
  "apps/party-tracker/"
  "packages/shared/"
  "public/"
  "vercel.json"
  "turbo.json"
  "package.json"
  "package-lock.json"
)

# Get the list of changed files. If VERCEL_GIT_PREVIOUS_SHA is not set,
# compare against HEAD~1 (the parent commit).
if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ]; then
  echo "Previous deployment: $VERCEL_GIT_PREVIOUS_SHA"
  CHANGED_FILES=$(git diff --name-only "$VERCEL_GIT_PREVIOUS_SHA" "$VERCEL_GIT_COMMIT_SHA" 2>/dev/null || echo "")
else
  echo "No previous deployment SHA, comparing against parent commit"
  CHANGED_FILES=$(git diff --name-only HEAD~1 2>/dev/null || echo "")
fi

if [ -z "$CHANGED_FILES" ]; then
  echo "No changed files detected, skipping build"
  exit 0
fi

echo "Changed files:"
echo "$CHANGED_FILES" | head -20
TOTAL_CHANGED=$(echo "$CHANGED_FILES" | wc -l)
if [ "$TOTAL_CHANGED" -gt 20 ]; then
  echo "... and $((TOTAL_CHANGED - 20)) more"
fi
echo ""

# Check if any changed file matches an app path
for file in $CHANGED_FILES; do
  for path in "${APP_PATHS[@]}"; do
    if [[ "$file" == "$path"* ]] || [[ "$file" == "$path" ]]; then
      echo "App-related change detected: $file"
      echo "Proceeding with build."
      exit 1
    fi
  done
done

echo "No app-related changes detected. Skipping build."
exit 0
