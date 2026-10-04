# Agent Note: The model is told which saved workflows it can nest

Status: implemented

English | [中文](2026-10-04-the-model-is-told-which-saved-workflows-it-can-nest.zh.md)

## Problem

A workflow script can nest a saved workflow with `workflow({ name, digest }, args)`, but the workflow tool's description never mentioned that hook, and nothing told the model which definitions were registered or what their digests were. A saved workflow could therefore be nested only in mechanism. On a preset composition the loader also finishes after the session is published, so a list taken at the first step could be empty only because loading had not finished (B-729; P4-09, question 31 (a)).

## Decision

- The workflow tool's description documents the `workflow({ name, digest, onFailure? }, args?)` hook and how it behaves: both fields must match a catalog entry, the nested run draws on the parent's budget and depth, and a failure rejects unless `onFailure: 'continue-parent'`.
- Before each step of an agent that resolves this tool, a pre-step listener publishes the registered definitions as a durable catalog message. The message uses the `plugin` source with the `catalog` form, one `name` and `digest` line per definition, so it is in the session log.
- The listener first waits for the saved-workflow loader in the same context to settle (`ctx.savedWorkflows.settled`). A failed load is named in the message.
- It publishes again only when the catalog changed or the last one left the visible surface. It remembers the last catalog from the events the session delivers, because new code may not read session history synchronously.
- The worker-thread engine gains a read-only `registeredDefinitions()`, and the registry a `currentDefinitions()`.

## Alternatives considered

- **Append the list to the tool description.** The description would change on every request in which the list changed, invalidating the cached prefix, and the tool schema is not recorded per session.
- **Add a system prompt section.** It is one per process, so agents that cannot call the tool would see it too, and a section added after the load is not sent to a session that started earlier.

## Consequences

- An agent's first step waits for a preset's saved-workflow load to finish before its first model request.
- A resumed session receives the catalog once more, even when it is unchanged.
- Not covered: definitions carry no description, so the catalog lists names and digests only. An engine without `registeredDefinitions()` lists nothing.
