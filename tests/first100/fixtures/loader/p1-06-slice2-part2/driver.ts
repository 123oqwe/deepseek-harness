#!/usr/bin/env node
/**
 * Driver for P1-06 slice-2 "part 2": out-of-process routing of THIRD-PARTY
 * plugin layers, through the shipped runProfile → composeProfile admission path
 * (the exact function part 2 modifies). Staged like `dsh plugin add` into the
 * profile's own node_modules, so each layer is third-party
 * (packageDir !== packageDirFromAnchor(INSTALL_ANCHOR, name)).
 *
 * It stages TWO third-party layers — one whose manifest declares
 * executionMode: 'process', one whose manifest declares executionMode:
 * 'in-process' (the untrusted in-process self-claim the fail-safe overrides) — each carrying
 * the SAME probe entry (probe-plugin.mjs). It boots the profile, then polls the
 * host tool registry for each layer's `probe--<name>` tool (its registration may
 * cross the RPC asynchronously after boot in the out-of-process world), and
 * prints one `P1-06-SLICE2-PART2 <json>` line: the host pid, and for each layer
 * the probe report it registered (pid, reachable forbidden services, visible
 * DSH_* env keys) plus whether its entry is present in the in-process loader
 * tree.
 * @module tests/first100/fixtures/loader/p1-06-slice2-part2/driver
 */

import type { Context } from '@deepseek-ai/cordis'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE_PATCH_RELOAD, initProfile, loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '../../../../../apps/cli/src/profile-boot.ts'
import { DECLARED_LAYER, INPROCESS_CLAIM_LAYER, probeToolName, REPORT_TOKEN } from './shared.ts'

const PROBE_ENTRY = fileURLToPath(new URL('./probe-plugin.mjs', import.meta.url))

/**
 * A manifest-v2 `dsh` field declaring exactly one tool by name and requesting no
 * wildcard destination (so the third-party layer is ADMITTED, not denied).
 * `executionMode` is a REQUIRED field and is always set — omitting it makes the
 * manifest invalid (denied at admission), so there is no "no-executionMode" case.
 */
function manifest(toolName: string, mode: 'process' | 'in-process'): Record<string, unknown> {
  return {
    manifestVersion: 2,
    tools: [{ name: toolName, sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal' }],
    executionMode: mode,
    compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
  }
}

/** Stage one third-party bundle layer under the profile's own node_modules, carrying the shared probe entry. */
function stageThirdPartyLayer(profileDir: string, name: string, mode: 'process' | 'in-process'): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    type: 'module',
    main: './index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' }, ...manifest(probeToolName(name), mode) },
  }))
  // A patch that inserts the layer's own entry into the in-process tree (today's
  // mount path). Part 2 excludes this entry for a third-party layer and spawns
  // the plugin out-of-process instead.
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), `- insert:\n    - id: ${name}-entry\n      name: ${name}\n`)
  copyFileSync(PROBE_ENTRY, join(pkgDir, 'index.mjs'))
}

const home = mkdtempSync(join(tmpdir(), 'p1-06s2-part2-home-'))
process.env.DSH_HOME = home
// Exercise the real admission path so routing operates on admitted layers.
process.env.DSH_PLUGIN_MANIFEST_ENFORCEMENT = 'enforce'
process.env.DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT = 'enforce'

const profileName = 'p1-06s2-part2'
const profileDir = resolveProfileDir(profileName, home)
// Base provides the tools runtime (ctx.tools) and the probed host services; the
// two third-party layers are the routing subjects.
initProfile(profileDir, ['@deepseek-ai/dsh-base', DECLARED_LAYER, INPROCESS_CLAIM_LAYER], DEFAULT_PROFILE_PATCH_RELOAD)
stageThirdPartyLayer(profileDir, DECLARED_LAYER, 'process')
stageThirdPartyLayer(profileDir, INPROCESS_CLAIM_LAYER, 'in-process') // schema-valid in-process CLAIM — the fail-safe case routing must override

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

/** Read a layer's registered probe tool from the host registry, polling briefly so an RPC-bridged registration can arrive after boot. */
async function readProbe(c: Context, layerName: string): Promise<unknown> {
  const want = probeToolName(layerName)
  const deadline = Date.now() + 2_000
  for (;;) {
    const schema = c.tools.schemas().find((s) => s.name === want)
    if (schema !== undefined) {
      try {
        return { found: true, ...JSON.parse(schema.description ?? 'null') }
      } catch {
        return { found: true, parseError: true, description: schema.description ?? null }
      }
    }
    if (Date.now() >= deadline) return { found: false }
    await new Promise((r) => setTimeout(r, 50))
  }
}

try {
  const loaderEntryNames = ctx === undefined ? [] : [...ctx.loader.entries()].map((e) => e.options.name)
  const report = {
    bootSucceeded: ctx !== undefined,
    bootError: bootError ?? null,
    hostPid: process.pid,
    loaderEntryNames,
    declaredEntryInTree: loaderEntryNames.includes(DECLARED_LAYER),
    inprocClaimEntryInTree: loaderEntryNames.includes(INPROCESS_CLAIM_LAYER),
    declared: ctx === undefined ? { found: false } : await readProbe(ctx, DECLARED_LAYER),
    inprocClaim: ctx === undefined ? { found: false } : await readProbe(ctx, INPROCESS_CLAIM_LAYER),
  }
  process.stdout.write(`${REPORT_TOKEN} ${JSON.stringify(report)}\n`)
} finally {
  if (ctx !== undefined) await ctx.fiber.dispose()
}
