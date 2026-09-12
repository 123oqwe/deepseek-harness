# AGENTS.md — Recorded-session snapshots

This tree contains only tests whose committed session JSONL is replay input and expected persisted output. Keep non-session ARIA, geometry, generator, CLI, and unit expected output with its owning app, script, or package; use `test:expected`, `test:web`, or `test` for its owning tier.

Every process under test starts through the `dsh` CLI with a shipped profile and optional scenario patches. Test clients may drive a public protocol or browser interface; do not add another application entrypoint, hidden CLI mode, or executable scenario driver.

A scenario composition may mount a `packages/test-support/` observer plugin, and only to establish a happens-before that the participants cannot establish among themselves. Such a plugin observes in-process events and nothing else: it must produce no session event and must not change any product plugin's decision, so the recorded fixture differs only by the events the pinned ordering itself produces. Every mount is named in the scenario's fixture explanation together with the race it pins. Such a plugin must also be listed in the root `package.json` devDependencies: the active-package inventory resolves an entry against the temporary profile directory and its own source path only, and a workspace package is not hoisted into the store's shared directory, so a dependency declared solely on the launching app does not resolve.

Each scenario owns or explicitly references one primary `session.jsonl` plus contiguous child files. The owner alone records or refreshes it. For an ordinary one-shot case, derive the user task and replay script from that JSONL; do not duplicate them in an `input.json`. Shared references are read-only, acyclic, and used only when another interface intentionally renders the same recorded behavior.

Committed sessions are normalization fixed points. Replace volatile identities with typed relationship-preserving tokens, replace request system prompts and tool schemas with tokens, and keep exactly one readable sidecar owner per header class. Never redact arbitrary user or tool text merely because it resembles an identifier.

An adapter-local symlink may expose a cross-profile prompt or schema sidecar only when `snapshot.yml` names that source; the corpus gate resolves the link and checks the declared target. The required snapshot lane runs these aliases on macOS and Linux.

Workspace seeds stay scenario-local. A scenario that mutates the workspace sets `workspace.final: true` and commits the complete result under `workspace.expected/`; use only the ignored `.empty` marker for an empty result. Record and refresh do not rewrite this independent oracle. Model prose and tool-result text do not prove the external effect.

`pnpm run test:snapshot` replays without writes. Recording and refresh use the explicit snapshot scripts, and every resulting JSONL, prompt, schema, protocol, UI, and workspace diff is reviewed before commit.
