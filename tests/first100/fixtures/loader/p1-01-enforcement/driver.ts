#!/usr/bin/env node
/**
 * Driver for P1-01 acceptance[0]/must[3] on a REAL shipped-launcher boot: under
 * plugin-manifest enforcement, the shipped `@deepseek-ai/dsh-base` and
 * `@deepseek-ai/dsh-headless` bundle layers stay while test layers of other
 * shapes are denied (pre-mount) or quarantined (post-mount). It is the G1
 * observation for B-519's first commit (BLOCKED-322).
 *
 * It boots through `runProfile` — the same orchestration `apps/cli/src/bin.ts`
 * runs — which reads the enforcement env, composes the profile with real
 * admission, and applies post-mount quarantine. BOTH enforcement env vars are
 * set to `enforce`: B-519's first commit reads `DSH_PLUGIN_MANIFEST_ENFORCEMENT`
 * and its second reads the feature gate `DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT`,
 * so setting both keeps this one driver enforcing unchanged across both commits.
 *
 * "A layer stays" is read from PRODUCT BEHAVIOUR, not logs: after boot the
 * driver runs one turn whose scripted model calls the base layer's `bash` tool;
 * the tool running proves base stayed, the task completing at all proves
 * headless stayed. "Denied"/"quarantined" is read from STDERR (the boot audit
 * is in-memory only), which the spec inspects.
 *
 * This increment stages the missing-manifest test layer; the declares-unregistered,
 * subpath-entry, and non-entry layers are added in a later increment.
 * It prints one `P1-01-ENFORCE <json>` line: the tool results the turn produced
 * and whether the turn reached the model at all.
 * @module tests/first100/fixtures/loader/p1-01-enforcement/driver
 */

import { randomUUID } from 'node:crypto'
import { FiberState } from '@deepseek-ai/cordis'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { DEFAULT_PROFILE_PATCH_RELOAD, initProfile, loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { runProfile } from '../../../../../apps/cli/src/profile-boot.ts'
import { MISSING_MANIFEST_LAYER, PROVIDER } from './shared.ts'

/**
 * Stage one on-disk bundle package under the profile's own node_modules — the
 * real `dsh plugin add` install location, resolvable by the profile Loader but
 * NOT by plugin-inventory's own location (which is why an entry test layer here
 * is skipped by the post-mount comparison until B-519's next fix).
 * @param profileDir - the profile directory whose node_modules receives the package.
 * @param name - the package (and bundle layer) name.
 * @param dshExtra - the `dsh` manifest fields beside `bundle.patch`, or undefined for none (legacy-untrusted).
 * @param patch - the bundle's cordis.patch.yml contents.
 */
function stageBundlePackage(profileDir: string, name: string, dshExtra: Record<string, unknown> | undefined, patch: string): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' }, ...dshExtra },
  }))
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), patch)
}

const home = mkdtempSync(join(tmpdir(), 'p1-01-enforcement-home-'))
process.env.DSH_HOME = home
// Both enforcement switches on: the first B-519 commit reads the first, the
// second commit reads the feature gate; setting both enforces on either.
process.env.DSH_PLUGIN_MANIFEST_ENFORCEMENT = 'enforce'
process.env.DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT = 'enforce'

const profileName = 'p1-01-enforcement'
const profileDir = resolveProfileDir(profileName, home)
initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', MISSING_MANIFEST_LAYER], DEFAULT_PROFILE_PATCH_RELOAD)
// The missing-manifest layer declares `dsh.bundle.patch` but no manifestVersion,
// so admission classifies it legacy-untrusted and its patch never mounts.
stageBundlePackage(profileDir, MISSING_MANIFEST_LAYER, undefined, `- id: ${MISSING_MANIFEST_LAYER}-row\n  name: cordis:noop\n`)

const mockOverlay = fileURLToPath(new URL('./mock.patch.yml', import.meta.url))
const { ctx } = await runProfile({
  environment: loadLayeredEnv('dsh', process.cwd()),
  profile: profileName,
  fromDefaultProfile: undefined,
  patchFiles: [mockOverlay],
  args: [],
})
try {
  // Created after boot, as a shipped launcher creates its root agent, so its
  // session starts once the capability-token service is listening.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  await runFixtureTurn(ctx, { task: 'P1-01: call the base tool once.' })
  const events = ctx.sessions.list().flatMap(session => session.snapshotEvents())
  const report = {
    reachedModel: events.some(event => event.type === 'turn/end'),
    // Every live Loader entry and whether its fiber is ACTIVE. A denied layer's
    // rows never mount (absent here); a quarantined entry is disposed (present,
    // not ACTIVE); an admitted, unquarantined layer's entries are present and
    // ACTIVE — which is exactly "neither denied nor quarantined" (headless stays).
    loaderEntries: [...ctx.loader.entries()].map(entry => ({
      name: entry.options.name,
      active: entry.fiber?.state === FiberState.ACTIVE,
    })),
    toolResults: events.flatMap(event => event.type !== 'tool/result' ? [] : [
      event.data.message.content.flatMap(block =>
        block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
    ]),
  }
  process.stdout.write(`P1-01-ENFORCE ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
