#!/usr/bin/env bash
set -euo pipefail

# PreCompact anti-drift anchor (maintainer decision C2). Re-injects the
# repo-local goal.md GOAL/NOW/RULES anchor into context immediately before
# compaction discards prior turns, so the next context window starts from
# the program's real state instead of whatever the compaction summary kept.
#
# Resolves the repo root via $CLAUDE_PROJECT_DIR (the harness-provided
# project-root env var for hook commands) or, failing that,
# `git rev-parse --show-toplevel` — NEVER `$(pwd)`. A hook invoked from an
# unexpected cwd must not silently read (or worse, write) a different
# project's goal.md; this repo runs alongside sibling worktrees on the same
# machine and a wrong-directory read is exactly the failure this hook exists
# to prevent.

repo_root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$repo_root" ]; then
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
fi

if [ -z "$repo_root" ]; then
  echo "PreCompact anchor: cannot resolve repo root (no CLAUDE_PROJECT_DIR, not a git worktree) — BLOCKED, goal.md not re-injected" >&2
  exit 1
fi

goal_file="$repo_root/.claude/goal.md"
if [ ! -f "$goal_file" ]; then
  echo "PreCompact anchor: $goal_file not found — BLOCKED, no anchor to re-inject" >&2
  exit 1
fi

node -e '
  const fs = require("fs");
  const content = fs.readFileSync(process.argv[1], "utf8");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreCompact", additionalContext: content },
  }));
' "$goal_file"
