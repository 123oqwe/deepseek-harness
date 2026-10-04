# Agent Note: Agent Team tools declare their risk domains

Status: implemented

English | [中文](2026-10-04-agent-team-tools-declare-their-risk-domains.zh.md)

## Problem

The nine tools of the experimental `dsh-experimental-tool-agent-team` declared no risk domain tags, so the shipped risk gate classified each call at `security-sensitive` by its unknown default and asked for approval. A headless run has no approver, so every call ended `unavailable`: `spawn_teammate` started no teammate, and the Lead's task-board calls never ran. The headless Agent Teams e2e timed out on every tree since the risk gate shipped (B-727, probes 37182024548 and 37182551593).

## Decision

- Each tool declares the tag its shipped counterpart declares: `spawn_teammate` `agent-spawn` (as `subagent`); `send_message` and `interrupt_agent` `agent-control` (as `tool-subagent-control`); `list_agents`, `team_task_list`, `team_task_get` and `wait_agent` `catalog-read` (as the subagent `list_agents`); `team_task_create` and `team_task_update` `session-state-write` (as `todo_write`).
- The shared keyless fixture (`apps/cli/tests/profiles/headless/tests/fixtures/team-llm.mjs`) reports a context window and answers a request that offers no tools, such as the session title, with text, so the e2e's stderr carries only the provenance line it asserts.

## Alternatives considered

- **Run the e2e with a permissive permission preset.** It would hide the defect: a headless deployment of Agent Teams would still be refused on every call.

## Consequences

- A headless Agent Team runs end to end under the shipped risk gate; each Team tool is gated as its shipped counterpart is.
