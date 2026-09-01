---
description: "Boot-time gate that aborts application startup when the checkout has drifted from its captured architecture/protocol baseline, for maintainers wiring or debugging the P0-01 preflight check."
kind: "package-reference"
---

# @deepseek-ai/dsh-baseline-preflight

English | [中文](README.zh.md)

## Summary

`pnpm baseline:capture` freezes a checkout's architecture- and protocol-critical fingerprint — Git SHA, toolchain, workspace package names, default bundle row ids, protocol/event schema hashes, and the pnpm lockfile hash — into `.dsh/baseline.json` (`scripts/release/baseline-fingerprint.mjs`). `dsh-baseline-preflight` re-verifies that fingerprint at boot: if the working tree has drifted from a captured baseline, `apply` throws with every drifted path named, and the throw propagates through Cordis fiber activation to abort startup before any execution batch begins. A checkout with no captured baseline at `<repoRoot>/.dsh/baseline.json` is not enrolled in the scheme and boots unaffected. The shared `dsh` base bundle carries this plugin's row `disabled: true` — opt-in per profile, not a shared-base default — because this repo's own committed `.dsh/baseline.json` permanently trails real `HEAD` (a moving target, not a bug to fix here); an unconditional row would abort every ordinary `pnpm dsh` invocation from this checkout. A profile that wants the gate re-enables the row explicitly.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `dsh` base bundle already carries the row, but disabled — a profile that wants the gate re-enables it by `id`, the same way any disabled base row is turned on. It only does anything in a checkout that has run `pnpm baseline:capture`; every other boot is untouched.

### When to choose it

Choose it to enforce P0-01's MUST clause: no execution batch against this checkout should proceed once its architecture/protocol fingerprint has drifted from the last captured baseline. Avoid enabling it (or override `repoRoot` to a directory with no `.dsh/baseline.json`) for a boot that intentionally has no relationship to a captured baseline — the disabled default row already no-ops everywhere, so this only matters once you have enabled it and want a specific `repoRoot` excluded from the gate.

### Setting it up

Re-enable the base bundle's disabled row by `id`, in a profile's own `cordis.patch.yml` or a `--patch` overlay (the same shape `apps/web/tests/pwsh-terminal.overlay.yml` uses to re-enable `tool-pwsh`):

```yaml
- id: baseline-preflight
  name: '@deepseek-ai/dsh-baseline-preflight'
  disabled: false
```

With no `config`, it verifies `process.cwd()`, matching the CLI's own default. Pin an explicit checkout instead of the boot cwd with `repoRoot`:

```yaml
- id: baseline-preflight
  name: '@deepseek-ai/dsh-baseline-preflight'
  disabled: false
  config:
    repoRoot: /path/to/checkout
```

A standalone composition that never includes the base bundle at all (a package-local test fixture, an unrelated tree) mounts the plugin directly instead, with no `disabled` field to override:

```yaml
- name: '@deepseek-ai/dsh-baseline-preflight'
```

### What you get

No drift: `apply` returns and boot proceeds normally. Drift: `apply` throws `Error: baseline-preflight: checkout has drifted from its captured baseline …` naming every drifted path and field, exactly as `pnpm baseline:verify` reports it; the throw aborts Cordis Loader activation, so `boot()` (`@deepseek-ai/dsh-app-boot`) rejects and the application never finishes starting. No captured baseline at `<repoRoot>/.dsh/baseline.json`, or a packed/installed environment where the verification tooling itself does not exist: `apply` returns without checking — this checkout has nothing to verify against yet. A disabled row (the base bundle default): `apply` never runs at all.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the plugin reaches the real drift check and why it stays a boot-time no-op outside an enrolled checkout; the observable behavior is fully covered in [Use this package](#use-this-package).

### One source of truth for the drift check

`scripts/release/baseline-fingerprint.mjs` exports `verifyBaseline(repoRoot)` — the same function `pnpm baseline:verify`'s CLI path calls — so the boot-time check and the standalone command can never disagree about what counts as drift. The script is a plain `.mjs` repo-tooling file outside every package's TypeScript project; `verifyBaseline` in `src/index.ts` reaches it with a dynamic `import()` built from a computed `file://` URL relative to this module (`import.meta.url`), not a static specifier, so the untyped cross-boundary import needs no project reference and TypeScript never tries to resolve the script's own module graph. The awaited result is narrowed once, against `BaselineFingerprintModule`.

### Why the base bundle row ships disabled

The base bundle row exists (`packages/bundle/base/cordis.patch.yml`) so the composition graph declares this gate's identity for every base-backed profile, but carries `disabled: true` — the same pattern the `hmr` row above it uses ("Module reload is opt-in per profile"). Two facts drove this, not one: `repoRoot` (`process.cwd()` by default) is, for the overwhelming majority of real usage, an end user's own project directory with no relationship to this monorepo's baseline-fingerprint scheme at all; and even for THIS checkout's own root, the committed `.dsh/baseline.json` is a moving target that trails real `HEAD` between captures, so an always-on row would abort ordinary `pnpm dsh` usage here too. A profile enables the row explicitly (see "Setting it up" above) when it wants the gate.

### Why a missing baseline, or unresolvable tooling, is a no-op rather than a failure

Once a profile enables the row, two further conditions still leave `apply` a no-op rather than throwing — both scoping facts about what there is to check, not silently skipped drift:

- **No captured baseline.** `apply` checks `existsSync(join(repoRoot, '.dsh/baseline.json'))` first: absent, it returns immediately, leaving `pnpm baseline:capture` as a separate, deliberate onboarding step for that checkout.
- **Unresolvable verification tooling.** `scripts/release/baseline-fingerprint.mjs` is repo-internal tooling, never part of this package's published `files`, so it exists only inside this monorepo's own source tree. `loadBaselineFingerprintModule` wraps only the dynamic `import()` step in a try/catch (never `verifyBaseline` itself); a resolution failure — the packed/installed case — is treated exactly like "nothing captured to verify against."

Once both a captured baseline AND the verification tooling are present, drift is a real regression against something the checkout explicitly captured, and `verifyBaseline` returning `ok: false` propagates as a boot-aborting error.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`Config`/`apply`, the dynamic import into `verifyBaseline`, drift-message formatting |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: the plugin performs one boot-time check and owns no package-local event history) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this gate to the fingerprint it verifies and the guard group it lives in.

- [`scripts/release/baseline-fingerprint.mjs`](../../../scripts/release/baseline-fingerprint.mjs) — `capture`/`verify` CLI and the shared `verifyBaseline` this plugin calls.
- [Testing policy](../../../docs/testing.md) — the boot-time verify gate section and the baseline-fingerprint report format.
- [`tests/release/baseline-fingerprint.spec.ts`](../../../tests/release/baseline-fingerprint.spec.ts) — the CLI-level capture/verify contract.
- [guard group map](../README.md) — the sibling guard packages.

-----

<a id="model-experience"></a>
## Model Experience

None: this plugin adds no prompt section, schema, or tool. It either lets boot proceed unchanged or aborts it before any agent, session, or tool registers, so no model ever observes a partial or degraded composition from it.

#### KV Cache effect

None; boot either completes or aborts before any request is ever assembled.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the gate is a poor fit. They are current package constraints, not a task backlog.

- **Opt-in, not shipped enabled** — the base bundle row is `disabled: true`; a profile enables it explicitly (see [Setting it up](#use-this-package)). No profile currently does.
- **No baseline means no check** — a checkout that has never run `pnpm baseline:capture` boots unaffected; this plugin only enforces drift against a fingerprint that was actually captured, never the absence of one.
- **Only meaningful inside this monorepo's own checkout** — `scripts/release/baseline-fingerprint.mjs` is repo-internal tooling, never part of this package's published `files`; a packed/installed consumer that enables the row anyway gets a permanent no-op, not an error, since the verification tooling itself cannot be resolved.
- **Boot-time only** — the gate runs once, at plugin activation; a working tree that drifts after a long-lived process has already booted is not caught until the next boot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
