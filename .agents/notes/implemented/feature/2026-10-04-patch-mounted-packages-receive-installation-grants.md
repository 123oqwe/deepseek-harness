# Agent Note: Patch-mounted packages receive the installation's grants

Status: implemented

English | [中文](2026-10-04-patch-mounted-packages-receive-installation-grants.zh.md)

## Problem

Under `plugin-manifest-enforcement: enforce`, a row a user patch layer mounts passes the same admission as a bundle layer (question 28 (a)), but only bundle layers could receive the installation's wildcard grants (question 27 (a)). Some published packages users mount by a patch row can only declare their reach honestly as a wildcard: `cordis_run` runs plugin code the session defines, `lsp` starts the language server the operator configures, `subagent_acp` starts the configured ACP agent, and the hooks bridges run the commands of the user's hooks file. Their honest manifests would be refused before mount or quarantined after it (4i1b step 3, Q1).

## Decision

- `INSTALL_WILDCARD_GRANTS` lists these grants beside dsh-base's and dsh-sdk-minimal's, per tool, or for a hooks bridge's package-level `process` field.
- `installationPackageWildcardGrants(name, dir, installAnchor)` gives a package its entry only when the directory has the real path of the installation's own copy; `installationWildcardGrants` applies it to a bundle layer.
- Pre-mount, a patch row denied only for wildcards its package is granted is admitted and recorded as `granted` in `admission-decisions.jsonl`, under its package name. Post-mount, `buildPluginPermissionStates` takes `packageWildcardGrants`, so an entry judged by its own package's manifest is decided on the wildcards the installation does not grant it.

## Alternatives considered

- **Grant by package name alone.** A package name can be copied; a same-named package outside the installation would receive the grants.
- **Require explicit `shadow` for these packages.** Every user of the shipped hooks bridges, language-server tool and dynamic Cordis tool would have to turn enforcement off.

## Consequences

- The installation's own copies of these packages are admitted and stay active on their grants under `enforce`; a copy the installation does not carry is refused or quarantined for the same wildcards.
- Each grant is visible in the grant table, in the inventory's `grantedWildcards` and, for a patch row, in the admission decision log.
