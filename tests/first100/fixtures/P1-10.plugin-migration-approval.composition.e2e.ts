/**
 * A-609 sub-case ③ (P1-10 1-5, green evidence): on the factory `dsh plugin`
 * path, an IRREVERSIBLE upgrade is refused until the operator confirms it, and
 * confirming with the named digest lets it proceed. must[2]'s approval-and-export
 * gate: `planUpgrade` admits the path but `!reversible`, so `requiresApprovalAndExport`
 * holds — `migrateChangedPlugins` exports the data and `admitIrreversibleUpgrade`
 * refuses `confirmation-required` (carrying the path digest) when no `--confirm`
 * is supplied, and admits it when `--confirm <digest>` matches.
 *
 * `notes-plugin` v1 (no migration) is installed and its data seeded; v2 declares
 * a 1 → 2 migration marked `reversible: false` whose `migrate` writes a marker
 * file ONLY when it runs. First `dsh plugin add v2` (no `--confirm`): the upgrade
 * is refused at freeze, the migration body never runs (no marker), and the data
 * is exported. Then `dsh plugin add v2 --confirm <digest>` (the digest read from
 * the refusal's message): the migration runs (the marker appears).
 *
 * Green evidence — the shipped gate already behaves this way. Each run is its own
 * `DSH_HOME`. §21.4 does not apply (no paired fix; this is existing behaviour).
 * Sub-case ① (a refused downgrade reverting the install) rides a later commit on
 * this spec once the revert path is confirmed.
 * @module tests/first100/fixtures/P1-10.plugin-migration-approval.composition
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import StorageHub, { type KvFacet, type KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')
const PROFILE = 'a609'
const PLUGIN = 'notes-plugin'
/** Deadline for one `dsh plugin` run. */
const COMMAND_TIMEOUT_MS = 120_000
/** The marker v2's migration writes ONLY when its body runs (so a refused upgrade leaves none). */
const MIGRATE_MARKER = 'a609-migrate-ran'

const MANIFEST_BASE = {
  manifestVersion: 2,
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '*' },
  dataStores: [{ domainName: 'notes', dataClassification: 'confidential' }],
}

/** v2's 1 → 2 migration module: IRREVERSIBLE, and its body writes a marker so a refusal (body never runs) is observable. */
const MIGRATE_2_IRREVERSIBLE = [
  "import { writeFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  "export const descriptor = { name: 'notes', version: 2, tables: ['notes'], hasGlobal: false }",
  'export async function migrate(content) {',
  `  writeFileSync(join(process.env.DSH_HOME ?? '', '${MIGRATE_MARKER}'), 'ran')`,
  '  return { ...content, tables: { ...content.tables, notes: { ...(content.tables?.notes ?? {}), migrated: true } } }',
  '}',
  'export async function validate() {',
  '  return true',
  '}',
].join('\n')

/** Pack the plugin at one version; v2 carries the irreversible migration. */
function pack(root: string, version: string, withMigration: boolean): string {
  const dir = join(root, `src-${version}`)
  mkdirSync(dir, { recursive: true })
  const dsh = withMigration
    ? { ...MANIFEST_BASE, migrations: [{ fromVersion: 1, toVersion: 2, description: 'irreversible notes change', module: './migrate-2.js', reversible: false, backup: 'snapshot' }] }
    : MANIFEST_BASE
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PLUGIN, version, type: 'module', dsh }, undefined, 2))
  if (withMigration) writeFileSync(join(dir, 'migrate-2.js'), `${MIGRATE_2_IRREVERSIBLE}\n`)
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', root], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(`pnpm pack failed: ${packed.stderr}`)
  return join(root, `${PLUGIN}-${version}.tgz`)
}

/** The unit descriptor at version 1. */
function notesAtV1(): KvUnitDescriptor {
  return { name: 'notes', version: 1, tables: ['notes'], hasGlobal: false }
}

/** Run one body against the JSON backend mounted as the product mounts it. */
async function withJsonBackend<T>(home: string, body: (kv: KvFacet) => Promise<T>): Promise<T> {
  const ctx = new Context()
  await ctx.plugin(StorageHub)
  await ctx.plugin(storageJson, { root: join(home, 'storages') })
  try {
    const kv = ctx.storage.backend.get('json').kv
    if (kv === undefined) throw new Error('the JSON backend offers no KV facet')
    return await body(kv)
  } finally {
    await ctx.fiber.dispose()
  }
}

/** Run one `dsh plugin --profile a609 add <tarball> [extra...]`. */
function addCommand(home: string, tarball: string, extra: readonly string[] = []) {
  return execa(process.execPath, ['--import', 'tsx/esm', binScript, 'plugin', '--profile', PROFILE, 'add', tarball, ...extra], {
    cwd: repoRoot,
    env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
  })
}

/** What the ③ scenario observed. */
interface ConfirmOutcome {
  readonly noConfirmText: string
  readonly digest: string | undefined
  readonly exportExists: boolean
  readonly migrateRanAfterNoConfirm: boolean
  readonly migrateRanAfterConfirm: boolean
}

const roots: string[] = []
let outcome: ConfirmOutcome | undefined
let setupError: string | undefined

beforeAll(async () => {
  try {
    const packRoot = await mkdtemp(join(tmpdir(), 'p1-10-confirm-pack-'))
    roots.push(packRoot)
    const v1 = pack(packRoot, '1.0.0', false)
    const v2 = pack(packRoot, '2.0.0', true)
    const home = await mkdtemp(join(tmpdir(), 'p1-10-confirm-home-'))
    roots.push(home)
    initProfile(resolveProfileDir(PROFILE, home), [])

    const installed = await addCommand(home, v1)
    if (installed.exitCode !== 0) throw new Error(`installing version 1 failed: ${installed.stderr.slice(-800)}`)
    await withJsonBackend(home, async (kv) => {
      const unit = await kv.open(notesAtV1())
      try {
        await unit.putRecord('notes', 'a', { body: 'original' })
      } finally {
        await unit.close()
      }
    })

    const noConfirm = await addCommand(home, v2)
    const noConfirmText = `${noConfirm.stderr}\n${noConfirm.stdout}`
    const migrateRanAfterNoConfirm = existsSync(join(home, MIGRATE_MARKER))
    const exportExists = existsSync(join(home, 'plugin-upgrades', `${PLUGIN}.v1.export.json`))
    const digest = /--confirm (?<digest>\S+)/u.exec(noConfirmText)?.groups?.digest

    if (digest !== undefined) await addCommand(home, v2, ['--confirm', digest])
    const migrateRanAfterConfirm = existsSync(join(home, MIGRATE_MARKER))

    outcome = { noConfirmText: noConfirmText.slice(-1000), digest, exportExists, migrateRanAfterNoConfirm, migrateRanAfterConfirm }
  } catch (error: unknown) {
    setupError = error instanceof Error ? error.message : String(error)
  }
}, 4 * COMMAND_TIMEOUT_MS)

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

describe('P1-10 1-5 (A-609 ③, green evidence): an irreversible upgrade is refused until confirmed, then proceeds with the named digest', () => {
  it('without --confirm the upgrade is refused and exported (migration body never runs); with --confirm <digest> it runs', () => {
    if (outcome === undefined) throw new Error(setupError ?? 'no outcome')
    const result = outcome
    const context = JSON.stringify(result)
    // Without confirmation: refused as confirmation-required (the message names
    // the digest to re-run with), the data is exported, and the migration body
    // never ran.
    expect(result.noConfirmText, context).toMatch(/confirmation-required/u)
    expect(result.digest, context).toMatch(/^\S+$/u)
    expect({ exportExists: result.exportExists, migrateRanAfterNoConfirm: result.migrateRanAfterNoConfirm }, context)
      .toEqual({ exportExists: true, migrateRanAfterNoConfirm: false })
    // With the named digest the irreversible upgrade is admitted and its
    // migration body runs.
    expect(result.migrateRanAfterConfirm, context).toBe(true)
  })
})
