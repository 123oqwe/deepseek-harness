# preFlight — P1-10 Usage stage

Measured at `4a58798bfd`, before any code.

## The two declared Usage files, measured

| declared file | what is there |
| --- | --- |
| `apps/cli/src/plugin.ts` | `runPlugin` forwards its arguments to `pnpm` in the profile directory and reconciles the manifest afterwards. There is **no upgrade subcommand**, and nothing in it reads a plugin's data schema version. |
| `packages/settings/settings/src/index.ts` | has `schemaVersion` and calls `registerSchema(..., identityMigration)` — but that is the **settings document's** schema, negotiated through `@deepseek-ai/dsh-schema-registry`. It is not a plugin's durable data. |

So the Usage stage is not "wire the transaction into an existing upgrade path". There is no upgrade path; `dsh plugin` installs and removes packages, and a plugin whose data shape changed has, today, no step between the new build landing and the plugin reading data it does not understand.

## A mechanism already exists next door, and it is not the same one

`@deepseek-ai/dsh-schema-registry` carries `registerSchema`, `evolveSchema`, `negotiateSchema` and `identityMigration`, with real production consumers: `sdk/server`, `sdk/protocol` and `session-persistence-jsonl`. It negotiates a version encountered in a payload against the version this build registered, and migrates the payload forward.

**That is a different subject from P1-10 and must not be conflated with it.** It converts a VALUE in memory as it is read. P1-10 converts a plugin's durable data on disk, under a transaction with a snapshot, a quarantine and a rollback, because the conversion cannot be redone on every read and a crash in the middle must leave one whole version behind. A `SchemaMigration` is a function from payload to payload; a plugin migration is six phases over a filesystem.

Two things follow, and the second is the one that needs a ruling:

1. P1-10 does not replace the schema registry, and the U stage must not route plugin data through `negotiateSchema` — that would make every read pay a conversion the transaction exists to do once.
2. **acceptance[1] — "data digest and schema version reconcilable" — has a vocabulary decision.** The registry's `SchemaVersion` is `{major, minor}`; P1-10's `PluginSchemaVersion` is an opaque branded string the plugin's own manifest declares. Reconciling them means either P1-10 adopts `{major, minor}`, or the two stay separate and acceptance[1] is reconciling a plugin's OWN version with its OWN digest, which is what the C stage already decided. I read it as the latter and will say so in the note; a ruling to the contrary changes the C-stage vocabulary, which is why it is raised rather than assumed.

## What U must build for acceptance[0]

The delegate's instruction: a crash injected at **each** of the six phases, restart, and the plugin is EITHER wholly old OR wholly new — never mixed. Six phases means at least six cases plus the enumeration guard.

**A crash has to be a real process death, not a thrown error.** A rejected promise unwinds `runUpgrade`'s `finally` and thaws the plugin; a `SIGKILL` does not. The campaign therefore runs the upgrade in a child process that kills itself at a named phase, then asserts on the disk the parent can still read. Anything less tests the error path rather than the crash path, which is exactly the distinction acceptance[0] exists for.

**What "wholly old or wholly new" is measured as:** the live directory opens as a SQLite database and its rows are either the pre-migration set or the post-migration set — not a count, not a file's existence. A half-migrated database can still exist and still open.

## acceptance[2]: read the permission state, never write it

"A failed upgrade does not change approved permissions" is a statement about P2-02's tokens and P2-04's approvals. This epic reads them and asserts they are unchanged across a failed upgrade; a case that granted or revoked anything to set up would be this epic writing state it does not own.

## Status

**No code written.** One ruling requested (acceptance[1]'s vocabulary). Freeze recorded run-and-pasted per §12.68 once the cases exist.
