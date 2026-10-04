/**
 * Names and the report shape the A-589 isolated-subtree-dispatch driver and the
 * spec beside it share. A-589 is the P0-02 U-2 probe (red first, §21.4: the fix
 * is not read): a subtree that isolates `policy` (an ordinary unpinned service)
 * and `tools`, mounts its own minimal {@link ToolRuntime}, forges a permissive
 * policy engine in its isolated slot, and dispatches a safety-critical forbidden
 * tool through the REAL tool-dispatch path — so the ActionManifest flows to
 * `enforceAction` from a genuine dispatch, not a hand-built request.
 *
 * The base deployment policy (`packages/bundle/base/cordis.patch.yml`:314,:331)
 * is `permit(...)` plus `forbid(...) when riskClass == "safety-critical"`, so a
 * safety-critical action is DENIED by the real engine at `enforceAction` and
 * PERMITTED by the forged always-permit engine. Whether the subtree dispatch is
 * refused BY POLICY (the real engine, `PolicyRefusedError`) or escapes the policy
 * layer and is caught only by the later risk gate (`RiskRefusedError`) is read
 * from the one execute result's error name.
 * @module tests/first100/fixtures/loader/a-589-isolate-subtree/shared
 */

/** The line prefix the spec parses the driver's JSON report from. */
export const REPORT_PREFIX = 'P0-02-ISO'

/** The safety-critical forbidden fixture tool the subtree dispatches. */
export const FORBIDDEN_TOOL = 'a589_forbidden'

/** The risk domain tag the overlay's `riskRules` map to `safety-critical` (the kernel hard-deny band). */
export const SAFETY_TAG = 'a589-safety'

/** The forged engine's policy-set digest, so a decision enforced under it is identifiable. */
export const FORGED_DIGEST = 'a589-forged'

/**
 * Which enforcement layer refused the subtree dispatch, classified from the
 * execute result's `error.info.name`:
 *  - `policy` — `PolicyRefusedError`: `enforceAction` itself refused (the real
 *    engine forbade the safety-critical action). The subtree dispatch was
 *    constrained by policy (the secure outcome).
 *  - `risk` — `RiskRefusedError`: the risk gate refused AFTER `enforceAction`
 *    permitted, so the forged policy's permit WAS enforced at the policy layer
 *    (the escape this probe asserts against).
 *  - `token` / `unrecorded` / `dispatch` — an incidental refusal upstream of the
 *    policy decision; a green on one of these would not be the policy layer
 *    holding, so the guards reject it.
 *  - `none` — no refusal; the forbidden effect performed.
 *  - `other` — an error with an unrecognized name (recorded in `resultText`).
 */
export type RefusalKind = 'policy' | 'risk' | 'token' | 'unrecorded' | 'dispatch' | 'none' | 'other'

/** What the single isolated-subtree dispatch observed. */
export interface IsolateProbeReport {
  /** Guard: the subtree's own {@link ToolRuntime} mounted and resolved under its isolated `tools` slot. */
  readonly toolMountedInSubtree: boolean
  /** Guard: the root Trust Kernel is pinned for this boot (the dispatch is not trivially unenforced). */
  readonly rootKernelPinned: boolean
  /** Diagnostic: `ctx.get('policy')` in the subtree resolved to the forged engine (the forge landed in the isolated slot). */
  readonly forgePolicyStuck: boolean
  /** Diagnostic: the subtree's resolved policy-set digest (`a589-forged` when the forged engine is read). */
  readonly subtreePolicyDigest: string | null
  /** Diagnostic: a separate `ctx.isolate('trustKernel')` + provide attempt did NOT land the forged kernel (the pin blocked a cross-realm kernel forge). */
  readonly kernelForgeBlocked: boolean
  /** Guard: the forbidden tool was actually dispatched through the subtree runtime (its execute returned). */
  readonly dispatched: boolean
  /** Whether the execute result is an error (a refusal), rather than a performed effect. */
  readonly resultIsError: boolean
  /** Which enforcement layer refused the call — see {@link RefusalKind}. */
  readonly refusalKind: RefusalKind
  /** Whether the forbidden tool's body ran (its marker is on disk). */
  readonly performed: boolean
  /** The execute result's text, trimmed — background. */
  readonly resultText: string
}
