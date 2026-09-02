# BASE-ALIGN-v2 new-gap wave map (DRAFT — pending delegate/panel review before SHA-pinning)

> Companion to `new-gap-matrix.md` (BLOCKED-037): supplies the per-stage
> (C/P/U/F) file breakdown, gate, and rollback that
> `implementation-wave-map.md` supplies for the canonical 100 epics. Same
> table-row format as that file (`## W<n>` wave headers, then
> `| Title | predecessors | **C(n):** \`files\` — desc. **P(n):** ... **U(n):**
> ... **F(n):** ... | Gate | Rollback |`), reusing the extractor's existing
> wave-map parser unmodified. This exists specifically so a new-gap epic's
> `waveMap.get(id)` lookup succeeds through the exact same assembly loop a
> canonical epic goes through — no separate code path, no separate
> treatment.
>
> **Status**: DRAFT stage breakdown, not yet reviewed — the file
> references themselves are grounded (verified to exist / verified as the
> right creation targets against the real `code-runtime-worker-thread`
> package), but the specific C/P/U/F split is a first pass. Declared
> per-stage counts below are kept consistent with the expanded file lists,
> per the extractor's own count-consistency check.

## W9

| P3-13 — Code-Runtime ExecutionWorld Policy Binding | P3-01, P3-02 | **C(3):** `packages/code-runtime/code-runtime-worker-thread/src/policy.ts`, `packages/code-runtime/code-runtime-worker-thread/src/protocol.ts`, `packages/code-runtime/code-runtime-worker-thread/tests/policy.spec.ts` — policy-decision type contract (allow/deny per capability request) and the RED fixture proving a policy-violating program body is rejected. **P(3):** `packages/code-runtime/code-runtime-worker-thread/src/bootstrap.ts`, `packages/code-runtime/code-runtime-worker-thread/src/worker.ts`, `packages/code-runtime/code-runtime-worker-thread/src/policy.ts` — real enforcement wired into the worker bootstrap/spawn path, consuming P3-02's policy vocabulary. **U(2):** `packages/code-runtime/code-runtime-worker-thread/src/index.ts`, `docs/subsystems/code-runtime.md` — Host-side runtime class composes the policy-bound world at real `ctx.codeRuntime` construction; doc records the seam's new policy binding. **F(1):** `packages/code-runtime/code-runtime-worker-thread/tests/policy.spec.ts` — fault/qualification: policy-violating program body denied, terminated worker's own spawned OS children checked for survival (real process-tree probe, not assumed). | Real malicious program body attempts a policy-forbidden network/filesystem/spawn action against a live worker-thread runtime and is fail-closed rejected; independent process-tree check after `terminate()`. | K — revert to the pre-P3-13 unrestricted worker-thread runtime (kill switch only, no policy binding) if the policy layer itself is found to be bypassable; never fall back to a weaker enforcement that still claims to be policy-bound. |
