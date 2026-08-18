#!/bin/bash
# SessionStart hook: install Matt Pocock skills globally for Claude Code.
#
# Web sessions start from a fresh container, so ~/.claude/skills has no Matt
# skills until this runs. Local sessions are skipped — humans install once via
# `node scripts/install-global-skills.mjs` (see docs/agents/skills-lock.md).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Idempotent: the container state is cached after a successful hook run.
if [ -f "$HOME/.claude/skills/codebase-design/SKILL.md" ]; then
  echo "Matt Pocock skills already installed in ~/.claude/skills"
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
node scripts/install-global-skills.mjs --agent claude-code
