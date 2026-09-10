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
