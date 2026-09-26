# Agent Note: A killed `dsh plugin` install is finished by the next run

Status: implemented

English | [中文](2026-09-26-a-killed-plugin-install-is-finished-by-the-next-run.zh.md)

## Problem

BLOCKED-342, P1-10 acceptance[0] on the CLI path: `runUnderLease` kept the profile's pre-install `package.json` and `pnpm-lock.yaml` in memory only. A `dsh plugin add` killed after pnpm installed the new code, at the migration module's import, in `migrate` or in `validate`, left the new code over the old data. The rerun then read the new `package.json` as its baseline, found no version change, migrated nothing and put nothing back. Lane A's A-447 measured all three kills: each rerun exited 0 with code 2.0.0 over data at version 1.

## Decision

- **The install records the code it starts from before pnpm runs.** `.dsh-install-in-flight.json` in the profile directory holds the pre-install `package.json` and `pnpm-lock.yaml` bytes, written atomically. It is removed once the install ends with code and data at one version: after the plugin lock is committed, after a failed migration's code rollback, or after a refused install is undone.
- **The next run finishes the install rather than undoing it.** A run that finds the record reads its version changes against the recorded manifest instead of the current one, so the interrupted upgrade's data migration runs on whatever data recovery left, and a migration that fails restores the recorded bytes. The run ends with the new version whole or, when the migration fails, the old version whole.
- Finishing is chosen because the operator asked for the new version. The data half resumes already: recovery puts half-done data back, and the migration skips data already at the new version.

## Alternatives considered

- **Undo on the next run.** Restoring the recorded bytes and reinstalling the old code first also reaches one whole version, but the same command then installs the new code again, a second install that adds no safety.
- **Keep the record in the harness home, beside the data upgrade records.** Those are per plugin, while the code rollback target is per profile; the profile directory holds the files it restores.

## Consequences

- An install whose run died after pnpm moved the code, and before the record was removed, is finished by the next `dsh plugin` command in that profile, whatever that command is. That run prints `finishing an install an earlier run began and did not complete`.
- When pnpm itself fails the record stays, and the next run starts from the same baseline.
- Verification: A-447 (`apps/cli/tests/plugin-migration-cli-crash.spec.ts`) and `apps/cli/tests/plugin-install-record.spec.ts`.
