# Agent Note: The installation grants its shipped layers' wildcards

Status: implemented

English | [中文](2026-10-03-the-installation-grants-its-shipped-layers-wildcards.zh.md)

## Problem

Under `plugin-manifest-enforcement: enforce`, a bundle layer whose Manifest v2 asks for a wildcard destination is refused before mount and quarantined after it. The shipped `@deepseek-ai/dsh-base` declares eight such tools (`read`, `read_image`, `glob`, `grep`, `write` and `edit` reach any path; `web_fetch` any host; `run_code` any command) and `@deepseek-ai/dsh-sdk-minimal` declares `run_code`, so enforcement would refuse the product itself. Post-mount quarantine also fired on a capability a layer declares but never registers, which CENSUS-1 found on every shipped layer. Question 27 (a) grants the shipped layers their wildcards explicitly; question 32 (a) quarantines only what a plugin registers without declaring.

## Decision

- **A grant table in the installation.** `INSTALL_WILDCARD_GRANTS` in `@deepseek-ai/dsh-app-boot`, beside `PROFILE_TEMPLATES`, lists per layer and per tool the destination kind, the pattern and the purpose of each grant: eight for dsh-base, one for dsh-sdk-minimal. It is not copied into profiles, so an older or custom profile composing the same layer gets the same grants. `installationWildcardGrants` gives a layer its entry only when its package directory is the one resolved from the installation anchor; a same-named package anywhere else gets none.
- **One split, both decisions.** `partitionWildcardFindings` in `@deepseek-ai/dsh-plugin-manifest` splits a manifest's wildcard findings into those a grant names (same tool, kind and pattern) and the rest; an MCP server's or a remote Skill provider's wildcard is never granted. `partitionProfileLayersByAdmission` admits a layer denied only for granted wildcards and lists it in `granted`; `buildPluginPermissionStates` decides a layer's states on the ungranted wildcards and shows the granted ones as `grantedWildcards`. Without grants both return exactly what they returned before.
- **Declared but never registered does not quarantine.** `decidePluginTrust` quarantines for an `undeclared-registration` mismatch or a wildcard finding; a `declared-not-registered` mismatch is still compared, recorded and shown.
- **A record of each decision.** An `enforce` boot appends one line per granted layer, refused layer and quarantine to `$DSH_HOME/feature-gates/admission-decisions.jsonl`: `recordedAt`, `layer`, `decision`, `grants` (`tool`, `destinationKind`, `pattern`, `source: install-grant-table`, `purpose`) and, for a refusal or quarantine, `reason`.

## Alternatives considered

- **Write the grants into each shipped profile template.** A template is copied into a profile once, so a profile created earlier would never receive a grant added later, and a custom profile composing dsh-base would have none.
- **Grant by layer and destination kind only.** A wildcard tool added to dsh-base later would be covered without anyone writing it down; per-tool grants make each new one an explicit edit.

## Consequences

- With enforcement on, the shipped layers are admitted and stay active on their grants, and the record names every grant they used.
- The default stays `shadow` in this change; the switch to `enforce` follows CENSUS-2's full run.
- Not covered: the decision log only grows, like the shadow log; a rows-level refusal of a user patch row goes to stderr, not to this log.
