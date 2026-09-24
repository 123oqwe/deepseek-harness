#!/usr/bin/env node
/**
 * Test driver for P1-09.composition.spec.ts: boot one of this directory's real
 * Loader compositions through the real `@deepseek-ai/dsh-app-boot` path and
 * write what the tool registry and the plugin inventory ended up holding to
 * the JSON report file named by `P1_09_REPORT`.
 *
 * The driver always exits 0. A composition whose plugin the registry refuses
 * makes `boot()` reject, and that refusal is the observation under test, not a
 * driver failure — so it is caught and reported as `booted: false` with the
 * message, rather than becoming an uncaught rejection the smoke would read as
 * a broken fixture. A failure while INSPECTING a tree that did boot is
 * reported separately as `inspectError`: conflating the two would let a broken
 * inspection masquerade as a refused registration.
 *
 * When the composition mounts the dynamic Cordis runner, the driver first
 * declares an owner the way the runner does for each dynamic package: from a
 * package fiber below a group fiber below the runner's own Loader entry. The
 * runner creates both fibers from its service context
 * (`packages/extensions/cordis-host-runner/src/index.ts`'s `requireGroup`, then
 * `lifecycle.ts`), and its `guard.ts` calls `declareOwner` in the package's
 * `apply`; the probe reproduces that fiber layout and that call without the
 * sandbox and the browser round trip a real definition needs.
 */

import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { buildToolOwnershipChain } from '@deepseek-ai/dsh-host-plugin-inventory'
import { fixtureTool } from './fixture-tool.ts'
import type { ReaderObservation, ReaderService } from './reader.ts'

/** The Loader entry name the shipped bundles give the dynamic Cordis runner. */
const RUNNER_ENTRY = '@deepseek-ai/dsh-cordis-host-runner'
/** The identity the runner-shaped probe declares, standing in for a runner-minted plugin id. */
const DYNAMIC_PROBE_IDENTITY = 'p1-09-dynamic-probe'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('p1-09-ownership driver requires a config path')
const reportPath = process.env.P1_09_REPORT
if (reportPath === undefined) throw new Error('p1-09-ownership driver requires P1_09_REPORT')

/** Everything P1-09.composition.spec.ts reads back after the process exits. */
interface Report {
  booted: boolean
  /** Why `boot()` rejected; absent when the tree booted. */
  message?: string
  /** Why inspecting a tree that DID boot failed; absent on a complete inspection. */
  inspectError?: string
  toolNames?: string[]
  owners?: Record<string, string>
  chain?: { capabilityId: string; current: string; replaces?: string }[]
  afterDisposeToolNames?: string[]
  afterDisposeChainLength?: number
  /** What `reader.ts` saw and did, when the composition mounts it. */
  reader?: ReaderObservation
  /** Why the runner-shaped declaration failed; absent when it was admitted or no runner is mounted. */
  runnerProbeError?: string
}

/** Read `message` off an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const report: Report = { booted: false }
try {
  const ctx = await boot('p1-09-ownership-loader-smoke', resolveConfigPath(configPath, undefined))
  report.booted = true
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name !== RUNNER_ENTRY || entry.fiber === undefined) continue
    try {
      const group = entry.fiber.ctx.plugin({ name: 'cordis-dynamic', apply: () => {} })
      await group.ctx.plugin({
        name: 'p1-09-dynamic-package',
        inject: ['tools'],
        apply(pkg: Context) {
          pkg.get('tools')?.declareOwner(DYNAMIC_PROBE_IDENTITY)
          pkg.tools.register(fixtureTool('dynamic_tool'))
        },
      })
    } catch (error) {
      report.runnerProbeError = messageOf(error)
    }
  }
  // After boot every entry has registered, so the reader sees what it attacks.
  const reader = ctx.get('p109Reader') as ReaderService | undefined
  if (reader !== undefined) report.reader = { ...reader.read() }
  try {
    const toolNames = ctx.tools.schemas().map(schema => schema.name).sort()
    report.toolNames = toolNames
    const owners: Record<string, string> = {}
    for (const name of toolNames) {
      const registration = ctx.tools.ownershipOf(name)
      if (registration !== undefined) owners[name] = String(registration.pluginIdentity)
    }
    report.owners = owners
    report.chain = buildToolOwnershipChain(ctx).map(entry => ({
      capabilityId: String(entry.capabilityId),
      current: String(entry.current),
      ...entry.replaces === undefined ? {} : { replaces: String(entry.replaces) },
    }))
    // Unload ONE plugin entry, not the root: the gate's "effects after unload
    // = 0" is a statement about what that plugin left behind in a registry
    // that is still live, which disposing the whole tree could not
    // distinguish from the registry itself going away.
    for (const entry of ctx.loader.entries()) {
      if (entry.options.name === './first-owner.ts') await entry.fiber?.dispose()
    }
    report.afterDisposeToolNames = ctx.tools.schemas().map(schema => schema.name).sort()
    report.afterDisposeChainLength = buildToolOwnershipChain(ctx).length
  } catch (error) {
    report.inspectError = messageOf(error)
  }
  await ctx.fiber.dispose()
} catch (error) {
  if (!report.booted) report.message = messageOf(error)
}

writeFileSync(reportPath, JSON.stringify(report), 'utf8')
