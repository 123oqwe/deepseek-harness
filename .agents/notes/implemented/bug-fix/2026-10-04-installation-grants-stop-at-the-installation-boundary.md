# Agent Note: Installation grants stop at the installation boundary

Status: implemented

English | [中文](2026-10-04-installation-grants-stop-at-the-installation-boundary.zh.md)

## Problem

`installationWildcardGrants` gave a shipped layer the installation's wildcard grants when the layer's package directory equalled the one Node's lookup found from the installation anchor. That lookup walks every `node_modules` directory up to the filesystem root, and the comparison was on paths as written. When the installation did not carry a granted name, the lookup reached a `node_modules` above it, such as one in the user's home, and a same-named package placed there received the grants (gate3 2026-10-04T06:09:59Z, weakness 1). The same path comparison treated one directory reached by two paths as two copies.

## Decision

- The installation's own copy is looked up only inside the installation: up to the outermost `node_modules` directory above the installation's real path, or its own `node_modules` when it sits in no `node_modules` (a source checkout). A name the installation does not carry has no copy and no grants.
- The layer's directory and the installation's copy are compared by real path. The bound applies to where the package is found, not to its real path: a workspace-linked package's real path lies outside every `node_modules`, and the installation is the trust root, so a link inside it is its own choice.

## Alternatives considered

- **Require the real path itself to lie inside the installation.** A source checkout links each workspace package from `apps/cli/node_modules` to `packages/`, outside any `node_modules`, so the shipped layers would lose their grants when run from source.
- **Compare file contents with a recorded digest.** The installation is the trust root and records no digest of its own packages to compare against.

## Consequences

- A layer named in the grant table and resolved from above the installation gets no grants; under `enforce` it is refused before mount for its wildcards.
