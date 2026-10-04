# Agent Note: Package-level wildcards are detected

Status: implemented

English | [中文](2026-10-04-package-level-wildcards-are-detected.zh.md)

## Problem

Wildcard detection (`detectWildcardPermissions` and `partitionWildcardFindings` in `@deepseek-ai/dsh-plugin-manifest`) read only the destinations of tools, MCP servers and remote Skill providers. A manifest's package-level `filesystem`, `network` and `process` fields were never checked, so a package declaring `process.commandPatterns: ["*"]` passed admission under `enforce` with no grant and no record. A package that spawns commands without registering a tool, such as the hooks bridges running the commands of a user's `hooks.json`, can only declare that reach at package level (4i1b step 3).

## Decision

- Detection covers every pattern of the package-level `filesystem.readPaths`, `filesystem.writePaths`, `network.hostPatterns` and `process.commandPatterns`, reported at those paths.
- A `WildcardGrant` may name no tool; such a grant covers only a package-level finding of its destination kind and pattern. A grant that names a tool covers only that tool's findings, and an MCP server's or a remote Skill provider's finding is never granted.
- The admission decision record omits `tool` for a package-level grant.

## Alternatives considered

- **Leave package-level fields unchecked.** Any package could then ask for any reach at package level and be admitted silently, which the default `enforce` exists to stop.

## Consequences

- A package-level wildcard is refused before mount or quarantined after it unless the installation grants it, and a grant is recorded like a tool grant.
