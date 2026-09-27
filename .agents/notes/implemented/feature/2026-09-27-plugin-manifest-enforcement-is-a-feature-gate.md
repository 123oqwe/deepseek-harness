# Agent Note: Plugin-manifest enforcement is a feature gate that defaults to shadow

Status: implemented

English | [中文](2026-09-27-plugin-manifest-enforcement-is-a-feature-gate.zh.md)

## Problem

P1-01 must[3] requires a production profile to deny a missing or legacy plugin declaration by default, but admission and post-mount quarantine ran only under an opt-in `DSH_PLUGIN_MANIFEST_ENFORCEMENT=enforce` switch that defaulted off. P0-05's feature-gate mechanism was wired into every boot, yet no gate was declared and nothing evaluated one (BLOCKED-322). User decision G1 makes plugin-manifest enforcement the first declared gate and turns it on by default; G1b asks for an explicit way for an operator to turn it off, with a warning at every boot. The shipped bundles' manifests do not yet declare everything their layers register, so an enforcing boot today denies `dsh-base` and `dsh-sdk-minimal` at admission for their wildcard destinations and quarantines the other shipped layers after mount.

## Decision

- `apps/cli/src/profile-boot.ts` declares `plugin-manifest-enforcement` (`PLUGIN_MANIFEST_ENFORCEMENT_GATE`): owner `@deepseek-ai/dsh-plugin-manifest`, introduced in 0.1.5-rc.2, `shadow` in every profile, removal version 0.2.0. `scripts/release/feature-gate-expiry.ts` declares the same gate for the release expiry check. `DSH_PLUGIN_MANIFEST_ENFORCEMENT` is removed; the gate's `DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT` replaces it.
- The default stays `shadow` until the shipped manifests declare what their layers register and the shipped templates grant the wildcard destinations their layers need (user question 27 (a)); the default then becomes `enforce`.
- `runProfile` resolves the gates once, before composing the profile, and provides that resolution on `ctx.get('featureGates')`.
- The launch environment layer may lower an `enforce` floor: whoever sets it starts the process and can already edit the profile's `package.json` and patch files. A settings layer, which a running process can change, keeps P0-05's refusal. `--dump-config` resolves the same way, so it shows what the boot does.
- Pre-mount admission and post-mount quarantine both go through `evaluateFeatureGate`. `off` composes every layer and disposes nothing; `enforce` denies and quarantines; `shadow` does what `off` does and appends each decision's redacted comparison with `enforce` to `$DSH_HOME/feature-gates/shadow-decisions.jsonl`, one line per decision with its boot stage. Nothing under `$DSH_HOME` recorded boot decisions before, so the log is new. A record keeps layer and package names, the entries a quarantine would dispose, denial reasons, mismatched capability names, and wildcard field paths.
- `off` writes one warning line to stderr at every boot; `shadow` writes none.

## Alternatives considered

- **Default to `enforce` now.** An enforcing boot denies or quarantines shipped layers until their manifests are complete.
- **Default to `off` until then.** `off` adds a warning line to every shipped launch's stderr and records nothing that completing the manifests can use.
- **Keep refusing every override of an `enforce` floor.** Neither G1b's operator switch nor a shadow observation on a shipped launch (BLOCKED-322 condition 3) could then exist.
- **Default custom profiles to `shadow` and the shipped templates to `enforce`.** It weakens must[3] for the profiles most likely to carry third-party plugins.
- **Write shadow decisions to stderr, or to the Trust Kernel's `auditAppend`.** stderr would change what the user sees in `shadow` (P0-05 acceptance[0]). `auditAppend` has no sink in the shipped CLI, so a record written there is dropped.

## Consequences

- The shipped default denies and quarantines nothing. Every boot appends two records, one per boot stage, to the shadow log, and nothing rotates the log.
- Under `enforce`, a boot drops a bundle layer that lacks a Manifest v2 or declares a wildcard destination. The shipped `dsh-base` and `dsh-sdk-minimal` declare wildcard destinations; how an enforcing boot treats them is the user's question 27.
- `off` and `shadow` differ in the one stderr warning line and in the shadow log; everything else a user sees is the same.
- This note supersedes in part [Feature-gate mechanism wiring before any real gate exists](../architecture/2026-09-01-feature-gate-mechanism-wiring-before-any-real-gate.md) (a real gate is declared, and the launch environment may lower `enforce`), [Plugin Manifest v2 real enforcement at profile boot](2026-09-02-plugin-manifest-real-enforcement-at-profile-boot.md) (enforcement is a gate that defaults to `shadow`), and [Shipped bundles declare Manifest v2, and a manifest is compared per package](2026-09-27-shipped-bundles-declare-manifest-v2-compared-per-package.md) (enforcement is a gate whose `shadow` default records what enforcing would do).
