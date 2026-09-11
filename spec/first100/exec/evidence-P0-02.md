# Evidence — P0-02 (确立 Minimal Immutable Trust Kernel 边界)

Written 2026-09-11 by lane B, after a per-clause read of an already-ACCEPTED epic. Nothing here re-judges the sign-off: all four cells are GREEN and `--check` is clean. The page exists because two things about this epic are true on today's tree and are recoverable only by re-measuring it — one of them a clause whose subject the repository does not model.

## 4.4 per clause

### acceptance[0] — 任意插件卸载、覆盖 service 或动态 mount 都不能替换 kernel policy/audit/signature verifier

**Covered, and the residual the sign-off recorded is now closed.** The sign-off (2026-09-01, BLOCKED-011, ANSWERED-BY-USER) accepted this clause with three property-access vectors documented as open and held unreachable by a CI gate rather than by the mechanism. On 2026-09-06 `f57c80a509` closed them structurally: `Fiber.store` became an accessor whose setter re-seals pinned names, and `Fiber.pinStoreName` fixes a name in every fiber of the tree (`vendor/README.md` local modification 20). `pin-hardening.spec.ts`'s three `SLICE-fiber-A` cases assert the refusals and superseded the "vector G"/"vector H" cases, which had asserted that the poisoning worked.

The clause is therefore satisfied more strongly than at sign-off, not less. `verify-trust-kernel-property-access` stays in force — it was built for the open state and is kept because a re-vendor that drops the patch would reopen the class (BLOCKED-130 is the re-vendor pointer).

Stale prose describing the old state survived in `src/index.ts` until BLOCKED-217; see that entry for what it would have cost.

### acceptance[1] — Kernel API 无模型可见文本、无业务领域逻辑、无具体 provider 实现

**Covered, and the P2-05 wiring did not erode it.** `src/types.ts` is six opaque handles and three payload-carrying records; every payload is `unknown`. There is no prompt, tool schema, or user-facing string in the type surface, and no domain vocabulary beyond `TrustKernelTrustAnchor`'s two signature modes, which are signature-root configuration — the thing must[1] gives the kernel to own.

The clause's live risk is the third conjunct, because P2-05 gave the kernel a real decider. It is discharged by *where* the decider is supplied: `TrustKernelConfig.policyDecider` is a construction parameter, so the deployment's boot owns it and the kernel's own type surface carries only the opaque function type. The kernel still contains no provider; it contains a slot. A kernel constructed without one denies every query (`src/index.ts:170-171`) — an entrypoint with no decider behind it refuses rather than permits.

### acceptance[2] — 未初始化 kernel 时，生产 profile 必须 fail closed
### acceptance[3] — 开发 profile 可显式启用 insecure 模式并显示永久警告

**Both clauses quantify over a profile kind this repository does not have, so the evidence proves a substituted proposition.** Measured 2026-09-11:

| what | reading |
|---|---|
| shipped profiles (`packages/boot/app-boot/src/profile.ts:154`) | 5 — `acp`, `web`, `headless`, `sdk`, `sdk-minimal`; each is a bundle list plus a `patchReload` mode |
| any production/development attribute on a profile | **none** |
| `enforceTrustKernelPosture` parameters (`apps/cli/src/profile-boot.ts:307`) | `initialized`, `insecureOptIn`, `warn` — **no profile** |
| `options.profile` reaching the posture decision | **never** — `runProfile` has it and does not pass it |

The proxy is the environment variable: `DSH_TRUST_KERNEL_INSECURE` absent is treated as production, present as development. The function's own JSDoc completes the substitution in one phrase — "A production boot (no opt-in)" — which defines production as the absence of the opt-in rather than observing anything about a profile.

The frozen cases (`apps/cli/tests/trust-kernel-posture.spec.ts`) pass two booleans, because the signature has no profile to pass. They establish *a boot without the opt-in fails closed, and one with it warns and proceeds*. That is correct, and it is not the clauses' literal content. The practical difference: `DSH_TRUST_KERNEL_INSECURE=1 dsh --profile web` boots with no kernel, so clause[3]'s grant — written for development profiles — is available to every profile, and clause[2]'s guarantee holds only where the variable is unset.

**Why this is recorded rather than escalated.** `enforceAction` (`packages/policy/policy-enforcement/src/index.ts:165-168`) resolves the kernel through `ctx.get('trustKernel')` and **throws** when it is absent: *a harness that cannot enforce must not proceed as though it had.* An insecure boot fails closed at the enforcement point on every action that reaches it. The boot does not fail closed; enforcement does. That is the same reading by which BLOCKED-011 accepted clause[0] on its real security intent rather than its letter, and the same answer applies here.

**The bound has its own bound.** `packages/policy/README.md` records that two of five dispatch paths reach the enforcement point at all; actions on the other three are not decided, with or without a kernel. That is P2-05 scope and documented there, not a P0-02 gap — but it means "enforcement throws" covers less than "every action is refused", and this page should not be read as claiming the latter.

**The substitution is forced and defensible.** With no profile-kind attribute to read, the environment variable is the only thing to key on, and requiring an explicit opt-in to skip a security control is the right bias. What was missing is that nothing said so: a reader comparing clause[2] to the cases sees "fail closed" asserted and "fail closed" proved, with no way to notice that 生产 profile dropped out in between. This page is that statement.

**If the clauses are ever to be met literally**, the posture function takes the profile and the profile gains the attribute — a registry-text and boot change, not a defect fix. Recorded as the option, not as a recommendation; given `enforceAction`'s throw, writing the substitution down is the cheaper and probably the correct answer.

## The shape, for the next reviewer

This is a third failure shape, distinct from the two this program has already catalogued:

- **Vacuous truth** (P0-06 acceptance[2]): the clause's set is empty, so it cannot be violated. The obligation transfers to whoever first makes the set non-empty.
- **Stale citation** (BLOCKED-217): prose outlives the code it describes, and a citation leads to a case that no longer exists.
- **Substituted subject** (here): the clause's subject has no referent in the tree, so the evidence necessarily proves an adjacent proposition. Nothing is empty and nothing is stale — the words simply do not denote, and the substitution is invisible at the point of comparison.

The third is the hardest to catch by inspection, because every artifact is individually correct: the clause is well-formed, the implementation is sound, the cases pass and prove what they claim. Only the join fails. The place it would have surfaced cheaply is preFlight — an acceptance clause naming a noun that appears nowhere in `packages/` or `apps/` is worth one question before implementation, not after sign-off.
