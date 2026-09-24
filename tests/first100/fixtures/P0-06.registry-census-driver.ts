/**
 * The schema-registry census on one shipped profile, for P0-06 acceptance[2].
 *
 * Run by `runLoaderSmoke` with `[overlayPath, profileName]` after the bin. It
 * boots that shipped profile through `bootProductionProfile` over the given
 * test overlay, reads every registration the running registry holds, and
 * writes `census.json` in its working directory: each schema id, its version,
 * how many versions its history holds, whether it is the declared identity
 * and, for a declared schema, whether its declaration holds against the
 * registered migration (`./p0-06-registry-census.ts`), and whether its
 * migration applied twice returns a probe payload deep-equal to itself. The
 * registry is read through the same module the product imports, so the
 * census is the product's own.
 */

import { writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { identityMigration, listSchemas } from '@deepseek-ai/dsh-schema-registry'
import { bootProductionProfile } from '../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { censusRecord } from './p0-06-registry-census.ts'

const [overlayPath, profile] = process.argv.slice(2)
if (overlayPath === undefined || profile === undefined) throw new Error('the census driver takes an overlay path and a profile name')

/** A payload no registered schema describes, so every migration sees it as foreign data. */
const PROBE = { p0_06_probe: [1, { nested: true }], text: 'probe' }

const ctx = await bootProductionProfile({
  binName: 'p0-06-registry-census',
  profile,
  overlayPaths: [resolveConfigPath(overlayPath, undefined)],
})
try {
  const entries = listSchemas().map(entry => ({
    ...censusRecord(entry, identityMigration),
    version: entry.version,
    historyLength: entry.history.length,
    roundTrip: isDeepStrictEqual(entry.migrate(entry.migrate(PROBE)), PROBE),
  }))
  await writeFile('census.json', `${JSON.stringify({ profile, entries }, null, 2)}\n`, 'utf8')
} finally {
  await ctx.fiber.dispose()
}
