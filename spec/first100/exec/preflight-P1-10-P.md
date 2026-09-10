# preFlight — P1-10 Provider stage (the six-phase upgrade transaction)

Supplements the approved epic preFlight and the C-stage supplement. Measured at `ccab879752`.

## Two premises corrected before writing anything

**`write-file-atomic` is not what the house pattern is.** The epic preFlight names it, and it is an npm package that this tree does not have — `grep write-file-atomic packages/*/*/package.json` returns nothing. What P1-03 established is `@deepseek-ai/dsh-atomic-write`, the repo's own module: `writeFileAtomic(filename, content, { mode, dirMode })` plus `withFileLock`, already used by `app-boot`, `credentials-local`, `llm-deepseek` and `plugin-lock`. The Provider stage uses that, and adding the npm package would be a second spelling of a mechanism the tree already has — the shape this program keeps ending.

**`node:sqlite`'s `VACUUM INTO` works on this runtime, measured rather than assumed.** A probe on the live Node produced an 8192-byte copy from an in-memory database. So the ledger's `adapt` is executable here, and the snapshot phase does not need a hand-rolled copy loop.

## What P delivers

`plugin-migrations/src/transaction.ts` and the two storage files the registry names. The six phases must[1] declares, as **data with the count guarded**, following P4-08.F and P2-04.F:

1. **freeze** — the plugin stops accepting work; nothing is copied yet.
2. **snapshot** — `VACUUM INTO` an atomically consistent copy under the plugin's own storage root, and `writeFileAtomic` the snapshot manifest beside it.
3. **quarantine** — the migration runs against the COPY in an isolated directory; production data is untouched and still readable.
4. **validate** — the migrated copy is checked, and its digest recorded (acceptance[1]).
5. **switch** — a same-filesystem `rename`, which is the only step that changes what a reader sees.
6. **health check** — the plugin is asked whether it works on the new data; a failure rolls back to the snapshot.

## What the freeze asserts: the intermediate states, not "it worked"

The delegate's instruction, and it is the difference between a transaction and a function that returns true:

- after **quarantine**, the isolated directory exists AND production is byte-unchanged — a migration that had already touched production would satisfy an end-to-end assertion just as well.
- after **switch**, the previous directory is still present and still a valid rollback target — the point of an atomic switch is that the old state survives it.
- after a **failed health check**, production is byte-identical to what it was before the switch — not "an error was returned".

`acceptance[0]`'s crash campaign — a crash injected at every step, leaving either the old or the new version whole — belongs to U, against the real upgrade path. A campaign against anything less proves nothing about the path that ships.

## The rollback target, and why the switch keeps it

A `rename` over a directory does not preserve what it replaced. So the switch renames the CURRENT directory aside before renaming the migrated one into place, and the aside is the rollback target until the health check passes. Two renames on one filesystem, in an order where every intermediate state is one a restart can resolve: this is what acceptance[0] will be measured against at U.

## Status

**No code written.** Freeze recorded run-and-pasted per §12.68 once the cases exist.
