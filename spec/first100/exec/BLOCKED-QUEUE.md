# First-100 BLOCKED queue (24×7 mode, decision C6 item 4)

Park-and-continue log. A parked lane's `epic`/`stage` frontier item is skipped
by the Supervisor until its answer entry appears below; the wave only closes
once its frontier is exhausted (all remaining items parked here or ACCEPTED).

Never edit or remove an entry except to append its answer once the maintainer
responds; append-only.

## Open

### BLOCKED-001 — P0-01.C target path collides with an unrelated existing artifact

- **When:** 2026-08-31, first attempt at W1's only epic, step SPEC-FREEZE (C-stage).
- **Epic/stage:** P0-01 ("锁定可复现审计基线与仓库指纹"), stage C (Contract).
- **What's blocked:** `spec/first100/sources/first100-requirements-matrix.md`'s P0-01 files list names `docs/audit/baseline-b150a551.md` [N] as an epic deliverable — the machine-generated output of the epic's own `pnpm baseline:capture` tool. That filename is baked to the baseline SHA frozen when the matrix was authored (`b150a551`). Decision A1 re-baselined to `0a53fb55`, so a correctly-implemented `baseline:capture` would naturally target `docs/audit/baseline-0a53fb55.md` instead — but that exact path already exists, populated this session with an unrelated artifact: the Supervisor's own R0.3A "native CI/pack health receipt" (`docs/audit/nativetestfullsuite-exit0-2b82aba798.md`'s sibling naming pattern; see `docs/audit/baseline-0a53fb55.md`), which is test-suite-result evidence, not a `baseline:capture`-produced fingerprint (Git SHA + Node/pnpm versions + workspace package list + protocol/event schema hashes, per P0-01's own MUST clause). The same collision pattern already existed pre-BASE-ALIGN: the inherited `docs/audit/baseline-b150a551.md` was also an R0.3A health receipt, never actually produced by P0-01's tooling — two different artifact classes have been converging on the same filename pattern throughout this program's history, and it has never been reconciled.
- **Why this can't be guessed past:** proceeding either risks a Writer overwriting real R0-gate evidence the current R0 exit gate closure depends on, or building P0-01's deliverable at a path that permanently conflicts with that evidence going forward.
- **Proposed resolution (Supervisor recommendation, not yet approved):** split the naming convention going forward — P0-01's `baseline:capture` output owns a distinct path (e.g. `docs/audit/baseline-fingerprint-<sha>.md`), and the Supervisor's own R0.3A/R0-gate evidence receipts keep the existing `docs/audit/baseline-<sha>.md` pattern. Requires maintainer confirmation before a Writer is dispatched.
- **Status:** ANSWERED 2026-08-31 — see below.

## Answered

### BLOCKED-001 — answer

- **Answered:** 2026-08-31, maintainer approved the Supervisor's proposed resolution verbatim.
- **Resolution:** the naming convention permanently splits going forward. P0-01's `baseline:capture` tool output owns `docs/audit/baseline-fingerprint-<sha>.md` (this cycle: `docs/audit/baseline-fingerprint-0a53fb55bea101816fa226bb964ae2bed71c343b.md`). The existing `docs/audit/baseline-<sha>.md` pattern stays permanently reserved for the Supervisor's own R0.3A/governance health receipts — never a P0-01 deliverable again.
- **Registry/matrix deviation recorded via the manifest-patch channel:** `tests/first100/adjudication.json`'s new `deliverablePathPatches` field (entry `P0-01`, stage `C`) records the approved substitute path against the byte-locked `declaredPath` (`docs/audit/baseline-b150a551.md`) from `tests/first100/registry.json`'s stage-C files — the registry itself stays unedited (byte-locked to the pinned planning sources), consistent with the existing `layerMapping`/`writeSerialization` maintainer-overlay pattern. Validated fail-closed by `checkDeliverablePathPatches()` in `scripts/first100/generate-specs.ts` (unit-tested in `generate-specs.spec.ts`); passed through into the generated `spec/deepseek-harness-optimization-manifest-v1.1.yaml`'s adjudication section for audit visibility. This does not re-scope P0-01's must/acceptance/nonGoals clauses.
- **Unblocked:** P0-01.C's SPEC_FREEZE step may now proceed. A Writer builds `.dsh/baseline.json` and `tests/release/baseline-fingerprint.spec.ts` unchanged, and the C-stage's baseline-artifact deliverable at `docs/audit/baseline-fingerprint-0a53fb55bea101816fa226bb964ae2bed71c343b.md` (the approved path), never the collision-prone `docs/audit/baseline-b150a551.md`/`docs/audit/baseline-0a53fb55.md` paths.
