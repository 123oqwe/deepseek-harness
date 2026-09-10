/**
 * Epic P1-10 acceptance[0]: a crash injected at EVERY phase leaves either the
 * old version whole or the new version whole, never a mixture.
 *
 * The crash is a real process death. A thrown error would unwind
 * `runUpgrade`'s `finally`, thaw the plugin and run the rollback — that is the
 * ERROR path, and testing it here would prove nothing about the one
 * acceptance[0] names. A child process that `SIGKILL`s itself at a named phase
 * leaves the disk exactly as the phase left it, which is what a machine losing
 * power leaves behind.
 *
 * "Whole" is measured by opening the live database and comparing its ROWS. A
 * half-migrated database still exists and still opens; only its contents say
 * which version survived.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { UPGRADE_PHASES } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { UpgradePhase } from '@deepseek-ai/dsh-plugin-migrations/transaction'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const OLD_ROWS = ['original']
const NEW_ROWS = ['migrated', 'original']

/** A plugin storage root whose live database holds the pre-migration rows. */
function storage(): string {
  const root = mkdtempSync(join(tmpdir(), 'p1-10-crash-'))
  roots.push(root)
  mkdirSync(join(root, 'data'), { recursive: true })
  const db = new DatabaseSync(join(root, 'data', 'data.db'))
  db.exec('CREATE TABLE notes (body TEXT)')
  for (const row of OLD_ROWS) db.prepare('INSERT INTO notes VALUES (?)').run(row)
  db.close()
  return root
}

/** Every row in the live database, which is what "whole" is measured on. */
function liveRows(root: string): string[] {
  const db = new DatabaseSync(join(root, 'data', 'data.db'), { readOnly: true })
  try {
    return db.prepare('SELECT body FROM notes ORDER BY body').all().map(row => String(row.body))
  } finally {
    db.close()
  }
}

/**
 * Run one upgrade in a child process that kills itself the moment `crashAt`
 * completes, and return once the child is gone.
 */
function upgradeUntilCrash(root: string, crashAt: UpgradePhase): void {
  const script = join(root, 'run.mjs')
  writeFileSync(script, `
import { runUpgrade } from ${JSON.stringify(new URL('../src/transaction.ts', import.meta.url).pathname)}
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const root = ${JSON.stringify(root)}
await runUpgrade({
  plugin: 'dsh-notes',
  manifest: { plugin: 'dsh-notes', current: '2', migrations: [{ from: '1', to: '2', backup: { kind: 'snapshot' }, reversible: true }] },
  installed: '1',
  storageRoot: root,
  freeze: async () => async () => {},
  migrate: async (quarantineDir) => {
    const db = new DatabaseSync(join(quarantineDir, 'data.db'))
    db.prepare('INSERT INTO notes VALUES (?)').run('migrated')
    db.close()
  },
  validate: async () => ({ ok: true, digest: 'sha256-validated' }),
  healthCheck: async () => true,
  onPhase: (phase) => {
    if (phase === ${JSON.stringify(crashAt)}) {
      // SIGKILL to self: no unwinding, no finally, no rollback. What is on
      // disk after this is what a machine losing power leaves behind.
      process.kill(process.pid, 'SIGKILL')
    }
  },
})
`, 'utf8')
  try {
    execFileSync(process.execPath, ['--import', 'tsx', script], { stdio: 'ignore' })
  } catch (killed) {
    // The child was killed on purpose; a non-zero exit is the point.
    void killed
  }
}

describe('P1-10 acceptance[0]: a crash at any phase leaves one WHOLE version', () => {
  it('covers every phase the transaction declares, so no phase is skipped silently', () => {
    expect(UPGRADE_PHASES.length).toBe(6)
  })

  it.each(UPGRADE_PHASES.map(phase => [phase] as const))(
    'crash at %s leaves the live data wholly old or wholly new',
    (phase) => {
      const root = storage()
      upgradeUntilCrash(root, phase)

      // The live directory must still open, and its rows must be exactly one
      // of the two versions. A mixture is the state acceptance[0] forbids.
      const rows = liveRows(root)
      const whole = JSON.stringify(rows) === JSON.stringify(OLD_ROWS)
        || JSON.stringify(rows) === JSON.stringify(NEW_ROWS)
      expect({ phase, rows, whole }).toEqual({ phase, rows, whole: true })
    },
  )

  it('leaves the OLD version whole for every crash before the switch', () => {
    // Sharper than "one of the two": before the switch renames the migrated
    // directory in, nothing the migration wrote can be visible, because it was
    // written to a copy.
    for (const phase of ['freeze', 'snapshot', 'quarantine', 'validate'] as const) {
      const root = storage()
      upgradeUntilCrash(root, phase)
      expect({ phase, rows: liveRows(root) }).toEqual({ phase, rows: OLD_ROWS })
    }
  })

  it('leaves the NEW version whole when the crash lands after the switch', () => {
    const root = storage()
    upgradeUntilCrash(root, 'switch')
    expect(liveRows(root)).toEqual(NEW_ROWS)
    // And the previous version is still on disk as the rollback target, so a
    // restart can still go back.
    expect(existsSync(join(root, 'rollback', 'data.db'))).toBe(true)
  })
})
