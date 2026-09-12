# preFlight — P2-10 Usage stage

Supplements `preflight-P2-10.md`, `-C.md` and `-P.md`. Written before the first line of U-stage code; everything measured at `96d499f6e0`. **Table only, no code.**

## What U is, after P

The Provider stage put a policy set where a deployment can state one: the `policy-set` settings namespace, whose resolved value carries the accepted set and its pin. **Nothing reads it.** U is the read side — and, measured, it is a smaller change than "wire up enforcement" suggests, because enforcement is already wired.

| reading | source |
| --- | --- |
| the enforcement point exists and is reached from **two real dispatch paths** | `core/agent-loop/src/tool-calls.ts:23` and `core/tools/src/ptc.ts:15`, both importing `enforceManifestedAction` |
| it asks whichever engine is mounted, and answers `policy-unavailable` when none is | `policy-enforcement/src/index.ts:164-178` |
| the Cedar engine is **already mounted in the shipped base** | `packages/bundle/base/cordis.patch.yml:287-289` |
| it takes its policy set from **hand-written bundle config**, not from settings | `:290-300`, two policies stated inline |
| **`dsh-settings-file` is already mounted in the shipped base**, over `$DSH_HOME/settings.yaml`, hot-reloaded | `:120-124` |

So P2-05's U already made a policy decision happen on every tool call. What P2-10's U changes is **where the enforced set comes from**: today a bundle author edits `cordis.patch.yml` and ships a new build; after U, a deployment edits the settings document it already has, and a bad edit leaves the last accepted set in force instead of taking down the boot.

That the settings provider is already in the base is the single fact that makes this cheap: the `policy-set:` section joins a document the shipped profile already reads and already hot-reloads.

## The U table

| clause | U decides | U builds | how a wrong build fails |
| --- | --- | --- | --- |
| must[1] — version pin | that the pin the namespace carries is **the one recorded on decisions**, so `ClosedDecision.policySet` and the namespace agree | the pin arriving through the same source seam as the set, replacing the constructor-time `this.digest` | Two digests for one set. `policySetDigest` (ids + sources) and the pin (+ vocabulary + engine version) would both circulate, and an audit row could not say which one its `policySet` was |
| must[2] — explain redaction | **not this slice** (ruling 3): the shadow record and the `feature-gates` bundle row are split out, so this slice keeps one subject | — | (carried to the shadow slice, where the failure is naming `PolicyExplain.matched` in `keepFields`: it is declared audit-only at `policy-engine/src/types.ts:205-210`, and a P0-05 record is a third place with no such declaration) |
| acceptance[0] — no I/O from a policy | **nothing new**: the set arrives through settings, which already owns the document | — | Re-adding a policy path to the engine's `Config` "for compatibility" |
| acceptance[2] — impact report | that the replay reads both sets **through the same namespace shape** P provides | the report's producer, over P's replay entry | A replay that reads the engine's `Config` for one side and the namespace for the other, comparing two different things |
| validation[2] — fail closed, keep last valid | **that the constructor's probe-throw is DELETED, not softened** | the engine taking its set from the source seam — never from `ctx.settings`, which it must not depend on — and validating nothing itself | Keeping both. Two things would decide what happens to a bad set, and they would disagree on the first failed reload |

## The three decisions, ruled 2026-09-12

1. **The shipped baseline goes through `SettingsRegisterOptions.base`.** The base bundle states two policies inline (`baseline-permit`, and the kernel hard-deny band), and they cannot simply move into a user's document — a deployment that has never edited settings must still get them. `base` resolves *below* the user layer (`settings/src/index.ts:54-55`), so the bundle supplies the baseline and a deployment overrides per policy id. P's `Config` therefore grows a `policies` field carrying that composition baseline, added at U. The division: **P supplies the mechanism (the field, and the registration that reads it), U supplies the content and the mount** — the baseline text lives in the bundle, not in this package.
2. **The engine is HANDED a set; it does not read the namespace.** `policy-engine-cedar` stays a pure evaluator with no dependency on settings; the dependency stays in `policy-language`. The engine's config gains a **policy-set source seam** — something that yields the current compiled set — rather than a literal map or a settings import.

   **The seam must yield the CURRENT set on every decision, and today's code is half-right about that.** Measured: `evaluate()` reads `this.config.policies` per call (`policy-engine-cedar/src/index.ts:259`), so the policy text is already re-read each time — but `this.digest` is computed ONCE in the constructor (`:221`) and passed to every decision (`:261`). Under a reload that changed the set, the policies would follow and the digest would not, and every decision would carry a digest naming a set that is no longer in force. So the seam replaces both: the set and its pin come from the same current value, or the audit trail lies in exactly the situation this epic exists to make safe.
3. **`feature-gates` entering the base bundle is split out of this slice.** It is must[1]'s shadow half, it carries a snapshot obligation, and it is independent of both decisions above. This slice says one thing — the enforced set comes from settings — and the shadow writer becomes its own later slice, so each has a single observable subject.

## What U must not take

- **Not a second digest.** One pin, computed once at acceptance, and re-read — never recomputed — per decision.
- **Not a settings dependency in the engine.** The seam yields a set; it does not import `@deepseek-ai/dsh-settings`.
- **Not the shadow writer.** Split out by ruling 3, with the `feature-gates` bundle row.
- **Not a policy file reader.** Settings owns the document.
- **Not `permission-presets`.** Unchanged through all four stages.
- **Not the F campaign.** Derived-M is F's; U replays the real corpus only.
