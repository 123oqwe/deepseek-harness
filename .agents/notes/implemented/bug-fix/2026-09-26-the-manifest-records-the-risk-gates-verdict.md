# Agent Note: The action manifest records the risk gate's verdict

Status: implemented

English | [中文](2026-09-26-the-manifest-records-the-risk-gates-verdict.zh.md)

## Problem

BLOCKED-315, P2-03 acceptance[2]: the manifest and the risk gate classified one action twice, and disagreed. Every dispatch path built its manifest through `classifySideEffect(undefined)`, so each call was recorded `destructive`, `classified: false`, `requiresApproval: true`, while the risk gate classified the same call by the organisation policy's rules for its declared domain tags and, under the shipped preset, let a `read` call run without asking. Lane A's A-443 measured it on the shipped headless profile: a probe the gate classifies `read` was recorded `destructive`, unclassified and requiring approval, on the native path and on the code-mode path.

## Decision

- **One table, in `@deepseek-ai/dsh-risk-taxonomy`.** `SIDE_EFFECT_CLASS_BY_RISK` maps each risk class to the class a manifest records: `read` to `read`; `local-reversible` and `internal-write` to `write`; `external-communication` to `network`; `destructive`, `financial`, `security-sensitive` and `safety-critical` to `destructive`. It is total and monotone, and no risk class yields `process`. The delegate approved the table on 2026-09-26.
- **One verdict per action.** `judgeActionRisk` (`@deepseek-ai/dsh-tools/external-effect`) takes the classification, the preset in force and that preset's approval decision once. The native, code-mode and direct paths record it in the manifest through `manifestClassificationOf` and hand it to `gateActionRisk`, which no longer takes its own.
- **`classified` follows how the class was reached.** A class a policy rule decided, or the kernel band, is recorded through the table with `classified: true`; the unknown default is recorded `destructive` with `classified: false`.
- **`requiresApproval` is the preset's decision.** A hard-denied action records `false`: the gate refuses it without asking, and `action/risk-gated` records the refusal.

## Alternatives considered

- **Keep the manifest preset-blind and let the gate decide alone.** The log then says an action required approval when the gate never asked, or the reverse; the delegate ruled that the manifest records the gate's actual decision.
- **Map a domain tag straight to a manifest class.** A tag is only an input to the risk classification, and a second mapping from it could disagree with the risk class.
- **Keep the table beside `ActionSideEffectClass`.** The risk gate would then read a table the manifest package owns; one package both sides read keeps one source.

## Consequences

- A classified call's manifest class now follows the table. The shipped `bash` call, `shell-execute` classified `internal-write`, is recorded `write` rather than `destructive`. The shipped policy set decides by `riskClass`, its only hard deny being the kernel band, so no shipped policy loosens. A deployment whose custom policy decides by `sideEffectClass` should decide by `riskClass` instead.
- Under `danger-full-access`, whose threshold lies above the unknown default, an unclassified action is not asked about, and its manifest records `classified: false` with `requiresApproval: false`. Under the shipped default preset it still requires approval.
- Recorded-session snapshots whose sessions call tools that declare domain tags record the mapped class and are refreshed.
- Verification: A-443 (`tests/first100/fixtures/P2-03.manifest-class.composition.spec.ts`) on both paths, and `packages/policy/risk-taxonomy/tests/side-effect-class.spec.ts`.
