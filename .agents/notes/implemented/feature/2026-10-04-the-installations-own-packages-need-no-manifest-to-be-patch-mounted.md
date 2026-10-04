# Agent Note: The installation's own packages need no manifest to be patch-mounted

Status: implemented

English | [中文](2026-10-04-the-installations-own-packages-need-no-manifest-to-be-patch-mounted.zh.md)

## Problem

Under plugin-manifest enforcement at `enforce`, a row a user patch inserts is admitted by its package's own declaration. Most packages the installation ships declare no Manifest v2, so a patch that inserted one of them was refused: CENSUS-4 (run 37218426287) recorded the sdk snapshots that insert `@deepseek-ai/dsh-code-runtime-worker-thread`, `@deepseek-ai/dsh-tool-bash-persistent` and `@deepseek-ai/dsh-session-title-first-prompt-llm` failing for it (BLOCKED-360). The identity check behind the installation's wildcard grants looked a name up only where the installation finds its direct dependencies, so in a source checkout a package the installation carries only transitively, such as `@deepseek-ai/dsh-tool-lsp`, missed its grants as well. That check also called `fs.realpathSync.native`, which the SEA-packaged executable's virtual file system does not answer.

## Decision

- `isInstallationPackage` (`@deepseek-ai/dsh-app-boot`) decides whether a resolved package is the installation's own copy: the installation's dependency closure carries its name, and the resolved directory has that copy's real path. The closure walks dependencies and peers from the installation. Direct dependencies are found inside the installation's own bound (the outermost `node_modules` above its real path, or its own `node_modules` in a source checkout); every further dependency only in a `node_modules` inside the installation root, the deepest directory holding the installation and its direct dependencies. A name found only above the root is not carried.
- A module proxy counts only at the shared fallback location for its name, where `healProfilesModuleFallback` writes the installation's own proxies; a proxy placed in a profile's own `node_modules` is not the installation's copy.
- Patch-row admission admits a row whose package declares no Manifest v2 (missing or legacy) when `isInstallationPackage` holds for the directory the row resolves to. A wildcard request is judged as before. The installation's wildcard grants, for bundle layers and patch rows, use the same identity.
- Real paths come from `fs.realpathSync`, which both pkg bootstraps answer on the virtual file system; the SEA bootstrap leaves `fs.realpathSync.native` unpatched.
- The closure is computed once per installation anchor in a process.

## Alternatives considered

- **Write a Manifest v2 into every shipped package.** Hundreds of published packages and every vendored one, the vendored ones changing pinned sources; the installation is the trust root, not a plugin to vet.
- **Exempt by package name.** Any package placed in a profile under a shipped name would pass.
- **Bound each dependency lookup by its parent's own `node_modules`.** A pnpm workspace places some dependencies in the workspace root's `node_modules`, outside every package's own.

## Consequences

- Under `enforce` a patch may insert any package the installation carries. A same-named copy in a profile, a link from a profile to a copy outside the installation, and a package found only above the installation are still refused for their missing manifest.
- The shared module fallback still links what Node's unbounded lookup finds; anything it links is admitted only through this identity.
- No ordinary gate boots the SEA-packaged executable; its virtual file system path is shown only by a `narrow_python_runtime` run.
