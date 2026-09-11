# preFlight — the memory slice (§12.79, BLOCKED-156 reading 1)

Per lifecycle §1.12: written before any code, measured at `ea15dcce29`. The user's ruling is that cross-session memory is ON by default; this records what the tree does today, which of §12.79's five items are buildable as stated, and the two that are not.

## The five items, measured

| # | §12.79 item | measured | verdict |
| --- | --- | --- | --- |
| 1 | base enables the `memory` / `memory-context` rows with `durableFileDirectory: !!js dshHomePath('memory')` | Both rows ship `disabled: true` (`bundle/base/cordis.patch.yml:366`, `:371`) with a comment stating why: `dsh-memory` registers no provider on its own, so an enabled row alone fails `MEMORY_PROVIDER_UNAVAILABLE` on every pre-step. `durableFileDirectory` is exactly the config that resolves that — `MemoryRuntime`'s constructor self-registers `createDurableFileMemoryProvider` when it is set (`memory/src/index.ts:125-127`). So enabling both rows AND naming the directory is coherent, and enabling them without it would ship the broken state the comment describes. | **buildable as stated** |
| 2 | the durable directory is `0700` | **Not satisfied, and not only for the directory.** `mkdir(options.directory, { recursive: true })` (`memory/src/index.ts:499`) passes **no mode**, so the directory is created at `0777 & ~umask` — `0755` on a normal login. The document itself is written with `writeFile`'s default, `0644`, then renamed into place. A user's durable memory is world-readable today on any shared host. | **real work, and it has a second half the item does not name — see below** |
| 3 | P6-01.U supplementary freeze on the SHIPPED profile | The mount-slice shape P4-11 just used applies unchanged: boot `dsh-base` through the Loader with a test overlay that supplies only a keyless model, and read back that `ctx.memory` resolves and a real recall happened. BLOCKED-156's whole point is that P6-01's green cells were green on a capability no shipped profile mounted. | **buildable** |
| 4 | two invariants, each a case plus a mutation | One holds in code today and needs its case written to assert the right thing; **the other has no subject at all.** Detailed below. | **one buildable, one blocked** |
| 5 | BLOCKED-155 reading 1: the seam stores a record shaped like P6-02's `MemoryRecord` | The durable provider stores `ScopedMemoryRecord` — `{ id, principal, content, updatedAt, scope }`, five fields (`memory/src/index.ts:598`). P6-02's `MemoryRecord` (`memory/src/record.ts:82`) declares `kind`, `subject`, `provenance`, `createdAt`, `validFrom`, `validUntil`, `confidence` on top of those. **None of those seven is stored.** | **buildable, with a durable-format consequence — see below** |

## Item 2: the file's mode is the half the instruction does not name

`0700` on the directory is the stated requirement, and it is the right one. But the record document inside it is written `0644`, and the two protect against different things: the directory mode stops a traversal, the file mode stops a read by anyone who already has a path to it (a backup process, a synced folder, a container bind mount). Fixing only the directory would leave a file whose own permissions say "world-readable" and rely entirely on the parent to make that untrue.

**Frozen intent:** the directory is created `0700` AND the document is written `0600`. **The mutation that must redden each:** drop the mode argument from `mkdir`, and drop it from the write — separately, because they are two decisions and a case that could not tell them apart would let either regress.

Note the write path is write-then-rename, so the mode must be set on the **temporary** file (or via the write's `mode` option) rather than after the rename, or there is a window where the real path is `0644`.

## Item 4a: "empty memory ⇒ the model sees identical bytes" — holds today, and the case must not assert the obvious wrong thing

`renderMemoryContext` returns `undefined` for zero records (`memory-context/src/index.ts:103`), and the consumer then returns the decision unchanged, so **no message is added and the model's input bytes are identical to a boot with memory disabled**. That is the invariant and it is true.

The trap: `agent.session.append('memory/access', …)` fires **whether or not anything was recalled** (`:155-160`, deliberately — "a read that returned nothing is still a read"). So a case asserting "nothing happened" would be false, and one asserting "no `memory/access` event" would assert the opposite of the design. **The case must compare the model-visible request bytes**, and separately assert that the read WAS recorded — the two together are the invariant, and either alone misstates it.

## Item 4b: "an untrusted workspace does not recall across workspaces" — no subject in this tree

Measured, and this is the one that blocks:

- `MemoryScope` is `{ tenantId: TenantId; sessionId?: string }` (`memory/src/types.ts:44-47`). **There is no workspace dimension.**
- `resolveMemoryAccessContext` sets `scope: { tenantId }` and nothing else (`memory-context/src/index.ts:91`).
- `grep` for `workspaceTrust` / `untrusted` across `memory-context/src` returns **nothing**: workspace trust is never consulted.

So two agents in different workspaces of the same tenant read the **same pool**, and there is no field in which a workspace boundary could be expressed. A case written against this today could only assert what already happens, and a mutation could not redden it, because nothing decides it.

**This is not a test to write; it is a decision to take.** The honest options:

1. **Add a workspace dimension to `MemoryScope`** and have `memory-context` populate it from the agent's workspace, refusing cross-workspace reads when the workspace is untrusted. This changes a public type of the P6-01 seam, and every provider's `inScope` with it.
2. **Rule the invariant out of scope for this slice** and record it against whichever epic owns workspace-scoped memory, with `landsIn` so the readiness gate holds it — the §12.46-B split this program already uses for a rule whose producer is elsewhere.
3. **Narrow the invariant to what the tenant boundary already gives** — cross-TENANT reads are already refused — and say plainly that cross-workspace is not covered.

**I am not choosing between these in a preFlight.** (1) is real work in another epic's public surface; (2) and (3) differ in whether the user's "memory on by default" ruling ships with a known cross-workspace read. That last point is the one that matters and is the delegate's: **turning memory on by default means every workspace in a tenant shares one pool, and P1-07's untrusted-workspace posture does not currently narrow it.**

## Item 5: storing the full record changes the on-disk format

`DURABLE_FILE_MEMORY_FORMAT_VERSION` is checked on read and an unknown version is refused by name (`memory/src/index.ts:488-492`). Storing `kind` / `subject` / `provenance` / `validFrom` / `validUntil` / `confidence` changes what a document holds, so the version bumps and any document written by the current build stops loading. Two questions follow, both for the delegate:

- **Is that acceptable?** Memory is opt-in today, so the population of existing documents is whoever enabled it by hand. The pre-release stance in `AGENTS.md` says backends reject old on-disk formats and there is no compatibility promise, which points at "bump and refuse" rather than a migration.
- **Where do the seven fields come from on `propose()`?** `MemoryProposeRequest` carries `principal`, `content`, `scope`. If the seam must store `kind` and `confidence`, either the request grows them or the provider invents defaults — and inventing a `confidence` for a record whose writer never stated one would be a fabricated number in durable data.

## What this slice does NOT touch

Items 1, 3, 4a and the two mode fixes in 2 are self-contained and can land together. 4b and 5 each need a ruling first, and they are independent of each other.

## Status

**No code written.** Two rulings requested (4b's scope decision, 5's format-and-defaults decision). The rest is measured and buildable; the freeze follows the code, run-and-pasted per §12.68.

-----

## Freeze draft for P6-01.U — measured, not entered

Drafted per §5.1.13 assignment; both `dryRunProof` re-run at `040ab46cb9` (tree `ab9d2181532a48317395004fffbe2cfb1e587c1d`). **Nothing here is written to `command-freeze.json`.** Attribution follows §12.79, which already settles it — *"P6-01.U 改在出厂 profile 上观测；两条不变量随开关走"* — so this is P6-01.U and no OQ is opened for the epic. The supplement number, and whether these supersede the existing U entry or append beside it, are the in-post delegate's at entry time; placeholders below. Stage attribution matters concretely: `verify-freeze-in-candidate-tree` checks a frozen entry against the cell its stage names, so a wrong stage is checked against the wrong cell.

**Local green is not observation.** Everything below is self-check: `pnpm exec vitest` on this worktree. Observation is CI on the exact SHA with the result landing in a cell, and the freeze precedes it. What local green establishes is only that the draft has something real to pin.

### The two invariants §12.79 ties to the switch, and which case observes each

**Neither is observed today. This is the draft's main finding, not a formality.**

**Invariant 1 — empty memory ⇒ the model's input bytes are identical.** *(Revised at `040ab46cb9`: the two cases described below now exist. The paragraph is kept as written because it is why they have the shape they do.)* The nearest case is `renderMemoryContext returns undefined for an empty recall so no empty snapshot is ever injected`, a unit assertion on the renderer's return value. It is not the invariant. Per item 4a above, the case has to compare the **model-visible request bytes** against a boot with memory disabled, and separately assert that the read **was** still recorded — `agent.session.append('memory/access', …)` fires whether or not anything was recalled (`memory-context/src/index.ts:155-160`, deliberately). Either half alone misstates the design: bytes-only would pass a build that stopped logging reads, and event-only says nothing about what the model saw. It belongs in `memory-context.spec.ts`, which is the file that boots the shipped profile.

**Now written.** The same driver runs twice over two overlays differing only in the `memory` / `memory-context` rows, and the mock adapter records the turn's request. Three things are excluded from the comparison, each because the memory switch does not decide it: the provider route; a message's per-run `id` and envelope `source`; and the temporary directory the harness chose, which the system prompt states. The adapter records only the FIRST request — the session-title plugin issues its own, and recording the last one compared two title prompts instead of two turns. Both mutations were run: injecting an empty snapshot reddens the byte case alone, skipping the `memory/access` append on an empty recall reddens the event case alone, and the source was restored byte-identical.

**Invariant 2 — an untrusted workspace does not recall across workspaces.** Half of it now has a subject and half still does not.

- The **dimension** exists: `MemoryScope.workspace` is populated and enforced, observed by four cases — `does not recall another workspace of the same tenant`, `recalls its own workspace, so the refusal above is not a blanket one`, `does not inherit the memories of a directory it replaced: same path, new identity`, `a reader naming NO workspace sees only records written without one`.
- **Trust is still never consulted.** `grep` for `workspaceTrust` across `memory-context/src` and `memory/src` returns one hit, and it is a comment (`memory-context/src/index.ts:111`). Nothing reads a workspace's trust state to decide a recall, so no case can assert the word "untrusted" without asserting something nothing decides.
- Those four cases also live in `durable-provider.spec.ts`, which the **P** entry freezes, not the U one. As drafted they would be pinned at the wrong stage for a §12.79 invariant.

So invariant 2's honest status is: **scope-by-workspace is real and observed at P; trust-gated recall has no subject.** Whether U owes a case that names trust, or the invariant narrows to the workspace dimension it now has, is a ruling this draft does not take — it is item 4b above, still open.

### Entry A — supersedes/extends the existing P6-01 **P** entry (durable provider)

```
epic:        P6-01
stage:       P
argv:        ["pnpm","exec","vitest","run","packages/memory/memory/tests/durable-provider.spec.ts","--reporter=json"]
expectExit:  0
files:       packages/memory/memory/tests/durable-provider.spec.ts
             packages/memory/memory/src/index.ts
             packages/memory/memory/src/types.ts
dryRunProof: { treeSha: ab9d2181532a48317395004fffbe2cfb1e587c1d, testsDiscovered: 30 }
```

Frozen at 17; the slice brings it to 30. The 13 added, grouped as the file groups them:

- *durable memory is written for its owner only* — `creates the directory 0700, so nothing else on the host can traverse into it`; `writes the document 0600, which the directory mode does not do for it`
- *memory is scoped to the workspace that wrote it* — the four listed under invariant 2 above
- *a stored record carries the origin its writer stated* — `refuses a version-1 document by name rather than reading it as origin-less`; `fixes an asserted claim at confidence 1 without the caller stating one`; `stores an inferred claim at the confidence its writer stated, not a house number`
- *a rebuilt workspace can be recognized without being read* — `counts what the displaced directory left, so a consumer can say so`; `returns a NUMBER and nothing else, so it is not a way around the scope check`; `does not count another TENANT's records at the same path`; `counts nothing when the path is untouched, so the count is not constant`

### Entry B — supersedes/extends the existing P6-01 **U** entry (consumer)

```
epic:        P6-01
stage:       U
argv:        ["pnpm","exec","vitest","run","packages/context/memory-context/tests/render.spec.ts","packages/context/memory-context/tests/memory-context.spec.ts","--reporter=json"]
expectExit:  0
files:       packages/context/memory-context/src/index.ts
             packages/context/memory-context/tests/render.spec.ts
             packages/context/memory-context/tests/memory-context.spec.ts
             packages/context/memory-context/tests/fixtures/driver.ts
             packages/context/memory-context/tests/fixtures/mock-llm.ts
             packages/context/memory-context/tests/fixtures/memory-context.patch.yml
             packages/memory/memory/src/index.ts
             packages/memory/memory/src/types.ts
             packages/core/session/src/known-event-types.ts
             packages/bundle/base/cordis.patch.yml
             packages/context/memory-context/tests/fixtures/empty-recall-driver.ts
             packages/context/memory-context/tests/fixtures/no-memory.patch.yml
             packages/context/README.md
dryRunProof: { treeSha: ab9d2181532a48317395004fffbe2cfb1e587c1d, testsDiscovered: 20 }
```

Frozen at 13; the slice brings it to 20. The 7 added:

- the `announceRebuiltWorkspace` group — `tells the session once that its workspace path holds an earlier occupant's memory`; `does not repeat itself on a later recall in the same session`; `stays silent when nothing was displaced, so a session does not claim a rebuild it never had`; `carries a count and a path and no record content, so it is not a read of what it reports`; `says nothing at all when the session has no workspace to compare`
- *an empty recall costs the model nothing* — `hands the model bytes identical to a boot with the memory rows disabled`; `still records the read that returned nothing, so silence is not an unlogged read`. These two are §12.79's first invariant, added at `040ab46cb9`; see the revision below.

`known-event-types.ts` is in `files` because `memory/workspace-rebuilt` is a new `SessionEventMap` member and an entry whose reality set omits it would not be re-checked when the event's registration changes.

### Entry C — the **C** entry is unchanged and is NOT re-frozen

`conformance.spec.ts` was edited by the slice (the `propose()` call sites grew `origin`) but its case list is the same 19 that are already frozen. A superseding entry with an identical `expectCases` would add a row that pins nothing new.

### What is still owed before either entry is written

1. ~~The invariant-1 case does not exist.~~ **Done at `040ab46cb9`.** Entry B's count moved 18 → 20 with it, Both entries' `dryRunProof` were then re-run at that same tree, so the two do not name different trees.
2. **`sensitivityProof` is absent from both entries and is not drafted here.** The two invariant-1 cases have their mutations run and recorded above; the other 18 added cases each still owe a mutation that reddens only itself with its controls green and the source restored byte-identical. That is a run, not a paste, and it has not been done. Listing a proof I have not executed would be the failure mode this program has already retracted once.
3. **Invariant 2's stage** — the four workspace cases sit in the P file. If §12.79's invariant is to be observed at U, either they move or U grows its own, and that is item 4b's ruling.
