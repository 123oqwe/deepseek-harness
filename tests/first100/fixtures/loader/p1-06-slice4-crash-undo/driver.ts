#!/usr/bin/env node
/**
 * Driver for P1-06 slice-4 m3 (crash → effects undone). Through the shipped
 * runProfile → composeProfile admission path, it stages ONE third-party layer
 * (executionMode: 'process') into the profile's own node_modules and boots the
 * profile, so the layer routes out-of-process and spawnPluginHost spawns its
 * plugin child. Then it:
 *   1. polls ctx.tools.schemas() until the layer's `probe--<name>` proxy tool
 *      appears (its registration crosses the RPC asynchronously after boot),
 *      reads the child pid from its description (control),
 *   2. SIGKILLs that child pid,
 *   3. polls ctx.tools.schemas() for the proxy tool's REMOVAL (the host's
 *      handle.done.finally(disposeHost) must revoke the session's
 *      registrations once the child exit is observed),
 * and prints one `P1-06-SLICE4-M3 <json>` line with the before/after presence,
 * the host pid, the child pid, and the kill outcome.
 * @module tests/first100/fixtures/loader/p1-06-slice4-crash-undo/driver
 */

import type { Context } from '@deepseek-ai/cordis'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE_PATCH_RELOAD, initProfile, loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '../../../../../apps/cli/src/profile-boot.ts'
import { CRASH_LAYER, probeToolName, REPORT_TOKEN } from './shared.ts'

const PROBE_ENTRY = fileURLToPath(new URL('./probe-plugin.mjs', import.meta.url))

/**
 * A manifest-v2 `dsh` field declaring exactly one tool by name and requesting no
 * wildcard destination (so the third-party layer is ADMITTED, not denied), with
 * the REQUIRED executionMode field set to 'process'.
 */
function manifest(toolName: string): Record<string, unknown> {
  return {
    manifestVersion: 2,
    tools: [{ name: toolName, sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal' }],
    executionMode: 'process',
    compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
  }
}

/** Stage one third-party bundle layer under the profile's own node_modules, carrying the probe entry. */
function stageThirdPartyLayer(profileDir: string, name: string): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    type: 'module',
    main: './index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' }, ...manifest(probeToolName(name)) },
  }))
  // A patch that inserts the layer's own entry into the in-process tree (the
  // non-routed mount path). composeProfile excludes this entry for a
  // third-party layer and spawns the plugin out-of-process instead.
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), `- insert:\n    - id: ${name}-entry\n      name: ${name}\n`)
  copyFileSync(PROBE_ENTRY, join(pkgDir, 'index.mjs'))
}

const home = mkdtempSync(join(tmpdir(), 'p1-06s4-crash-undo-home-'))
process.env.DSH_HOME = home
// Exercise the real admission path so routing operates on an admitted layer.
process.env.DSH_PLUGIN_MANIFEST_ENFORCEMENT = 'enforce'
process.env.DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT = 'enforce'

const profileName = 'p1-06s4-crash-undo'
const profileDir = resolveProfileDir(profileName, home)
// Base provides the tools runtime (ctx.tools); the third-party layer is the routing + crash subject.
initProfile(profileDir, ['@deepseek-ai/dsh-base', CRASH_LAYER], DEFAULT_PROFILE_PATCH_RELOAD)
stageThirdPartyLayer(profileDir, CRASH_LAYER)

let ctx: Context | undefined
let bootError: string | undefined
try {
  ctx = (await runProfile({
    environment: loadLayeredEnv('dsh', process.cwd()),
    profile: profileName,
    fromDefaultProfile: undefined,
    patchFiles: [],
    args: [],
  })).ctx
} catch (error) {
  bootError = error instanceof Error ? error.message : String(error)
}

const want = probeToolName(CRASH_LAYER)

/** Is the proxy tool currently live in the host registry? */
function present(c: Context): boolean {
  return c.tools.schemas().some((s) => s.name === want)
}

/** Poll the host registry until the proxy tool appears; return its reported child pid, or null on timeout. */
async function waitForRegistration(c: Context): Promise<number | null> {
  const deadline = Date.now() + 3_000
  for (;;) {
    const schema = c.tools.schemas().find((s) => s.name === want)
    if (schema !== undefined) {
      try {
        const pid = (JSON.parse(schema.description ?? 'null') as { pid?: number } | null)?.pid
        return typeof pid === 'number' ? pid : null
      } catch {
        return null
      }
    }
    if (Date.now() >= deadline) return null
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** Poll the host registry until the proxy tool is gone; return whether it is still present at the deadline. */
async function waitForRemoval(c: Context): Promise<boolean> {
  const deadline = Date.now() + 5_000
  for (;;) {
    if (!present(c)) return false
    if (Date.now() >= deadline) return true
    await new Promise((r) => setTimeout(r, 50))
  }
}

let childPid: number | null = null
let presentBeforeKill = false
let presentAfterKill = false
let killIssued = false
let killError: string | undefined
try {
  if (ctx !== undefined) {
    childPid = await waitForRegistration(ctx)
    presentBeforeKill = present(ctx)
    if (childPid !== null && childPid !== process.pid) {
      try {
        process.kill(childPid, 'SIGKILL')
        killIssued = true
      } catch (error) {
        killError = error instanceof Error ? error.message : String(error)
      }
    }
    // After the kill the host's handle.done.finally(disposeHost) must revoke the
    // registration; if it does not (mutation), the tool lingers to the deadline.
    presentAfterKill = killIssued ? await waitForRemoval(ctx) : present(ctx)
  }
  const report = {
    bootSucceeded: ctx !== undefined,
    bootError: bootError ?? null,
    hostPid: process.pid,
    childPid,
    presentBeforeKill,
    presentAfterKill,
    killIssued,
    killError: killError ?? null,
  }
  process.stdout.write(`${REPORT_TOKEN} ${JSON.stringify(report)}\n`)
} finally {
  if (ctx !== undefined) await ctx.fiber.dispose()
}
