---
description: "Package map for the guard family: the advisory repeat-tool reminder, the per-call tool-call timeout policy, and the boot-time baseline-drift preflight, for users and maintainers choosing or composing the guards."
kind: "package-group"
---

# guard/ — guard family

English | [中文](README.zh.md)

## Summary

The `guard/` group watches for failure patterns outside the agent loop's own logic. `repeat-tool-reminder` notices when the model repeats the exact same tool call and reminds it to change approach or finish, so a stuck loop stops burning time and tokens. `timeout-policy` puts a time limit on tool calls that declare one, so a hung call returns a clear timed-out error to the model instead of stalling the session. `baseline-preflight` runs once at boot, before any of that: if the checkout has drifted from its captured architecture/protocol baseline, it aborts startup instead of letting an execution batch run against a stale fingerprint. `repeat-tool-reminder` and `timeout-policy` ship enabled in the `dsh` base bundle; `baseline-preflight`'s row ships `disabled: true` there (opt-in per profile — see its own README for why). A composition can tune, enable, or remove any of them.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Three small plugins cover three patterns; each README below explains when to keep, tune, or remove it.

| Package | What it provides |
|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Reminds the model when it repeats the same tool call, so it changes approach or finishes |
| [`timeout-policy/`](timeout-policy/README.md) | Times out tool calls that declare a limit, so the model gets a clear error instead of waiting forever |
| [`baseline-preflight/`](baseline-preflight/README.md) | Aborts boot when the checkout has drifted from its captured architecture/protocol baseline |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the tools subsystem reference for the tool-call pipeline, then the reminder's configuration and the timeout-library decision behind the policy.

- [Tools subsystem reference](../../docs/subsystems/tools.md) — the tool-call pipeline and decisions the tool-call guards build on.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) — every accepted field of the repeat-call reminder.
- [Timeout deadline library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) — the timing/termination split `timeout-policy` enforces.
- [Testing policy](../../docs/testing.md) — the boot-time verify gate `baseline-preflight` implements, and the baseline-fingerprint report format.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
