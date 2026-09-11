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

# The session-local half of the anchor, when this session keeps one. It is
# deliberately untracked — each session's delegate, NOW and QUEUE differ — so
# its absence is the normal case and never an error. It is folded into the SAME
# additionalContext rather than emitted separately, because a hook returns one.
goal_local_file="$repo_root/.claude/goal.local.md"

node -e '
  const fs = require("fs");
  const [, goalPath, localPath] = process.argv;
  let content = fs.readFileSync(goalPath, "utf8");
  if (localPath !== undefined && fs.existsSync(localPath)) {
    // The separator names the file, so a reader of the merged block can tell
    // which half a line came from and where to edit it.
    content += `\n\n---\n\n# Session-local anchor (.claude/goal.local.md)\n\n${fs.readFileSync(localPath, "utf8")}`;
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreCompact", additionalContext: content },
  }));
' "$goal_file" "$goal_local_file"
