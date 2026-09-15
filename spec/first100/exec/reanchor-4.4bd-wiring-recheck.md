# 4.4b-d runtime wiring re-check — beyond "the symbol exists"

Second pair of eyes before sign-off. Measured 2026-09-14, read-only grep against the merged tree and `4618dcbf06`. **Nothing built, typechecked or installed.**

4.4a asked whether the symbol survived; that page is `reanchor-accepted-declaration-recheck.md`. This one asks whether it is still *reached*.

## The instrument mistake this check invites

**"Not mounted in a bundle" is not "not wired."** I nearly filed `policy-enforcement` as a finding on that basis and it would have been wrong.

Of the 51 first100 packages, **23 are mounted** in some `cordis.patch.yml` across the six bundles (`acp-app`, `base`, `headless`, `sdk-app`, `sdk-minimal`, `web-app`) and **28 are not**. Most of the 28 are vocabulary and contract packages that ship no plugin at all — `action-manifest`, `principal`, `lease-contract`, `secrets-broker`, `resource-budget`, `schema-registry` and so on — for which a mount would be meaningless.

Four of the 28 *do* ship a plugin (`export default class` or `export function apply`):

| package | verdict |
|---|---|
| `test-support/job-settle-signal` | test-support; a mount would be wrong |
| `policy/policy-enforcement` | **wired as a library, not as a plugin** — see below |
| `workflow/workflow-filesystem` | unmounted **at the base too** (0 references) — pre-existing, not merge-caused |
| `workflow/workflow-registry` | unmounted **at the base too** (0 references) — pre-existing, not merge-caused |

### `policy-enforcement` is reached, and 4.4b is the wrong instrument for it

It appears in no bundle and no `cordis.yml`, at the merged tree **and at the base** — so nothing about this is a re-anchor effect. But it has three production call sites, reached by direct import:

```
packages/core/agent-loop/src/tool-calls.ts:23   import { enforceManifestedAction }
packages/core/tools/src/ptc.ts:15               import { enforceManifestedAction }
apps/cli/src/profile-boot.ts:49                 import { endorseComposedDecision }
```

Those first two **are** P2-05's "enforcement point on both dispatch paths" — native tool calls and code mode. The capability is wired; it simply is not a mounted plugin. For a library-shaped package the 4.4c call-point check is the instrument that answers the question, and it passes.

## 4.4c — production call points for the conflicted declared symbols

| symbol | non-test files reaching it | declared by |
|---|---|---|
| `resolveProfile` | 11 | P1-01, P1-08 (`app-boot/src/profile.ts`) |
| `composeProfile` | 10 | P0-02, P0-05, P1-01, P1-03 (`profile-boot.ts`) |
| `assertRuntimeTenantPolicy` | 10 | P2-01, P2-02 (`runtime-context.ts`) |
| `pluginEnforcement` | 1 | P1-01 (`profile-boot.ts`) |

All four remain reached from production code after the merge. `pluginEnforcement` at 1 is the thin one — it is a single enforcement site by design, but it is also the value where a lost call site would take it to 0 and nothing else would notice.

## What did not change, and what I did not check

No 4.4b-d regression is attributable to the re-anchor: every unmounted plugin package was unmounted at the base as well, and every symbol above is still called.

**This is reachability by grep, not by execution.** A symbol being imported does not prove the call is on a live path, and a package being mounted does not prove its plugin applies cleanly. 4.4d in the strict sense — the capability actually functioning end to end — is what the snapshot suite and the registry gate set answer, and neither has run on the merged tree yet. The delegate's own pass before signing remains the authority.
