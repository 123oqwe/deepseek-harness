#!/usr/bin/env node
/**
 * CENSUS-1 (never merge; B-519 step 2, plan 16c5a224 §1): boot one shipped
 * profile template through the shipped `runProfile`, with the
 * plugin-manifest-enforcement gate at its shipped default (`shadow`), and
 * print every shadow decision the boot recorded: the pre-mount admission
 * record names the layers enforce would deny, and the post-mount comparison
 * record names, per layer, the registrations its manifest does not declare and
 * the declarations nothing registered.
 *
 * Each template gets the arguments that keep its app running past the
 * post-mount comparison: the headless task is routed to a model that never
 * answers (`./hang-llm.ts`, inserted by a `--patch` overlay that disables no
 * shipped row), the Web app listens on a free loopback port without opening a
 * browser, and the stdio apps read the stdin the spec keeps open.
 *
 * Prints one `P1-01-CENSUS <json>` line, then disposes the tree and exits 0.
 * @module tests/first100/fixtures/loader/p1-01-census/driver
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Context, FiberState } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { featureGateShadowLogPath, runProfile } from '../../../../../apps/cli/src/profile-boot.ts'
import { CENSUS_ROUTE } from './hang-llm.ts'

/** The arguments each shipped template is launched with. */
const ARGS: Readonly<Record<string, readonly string[]>> = {
  'headless': ['--model', `${CENSUS_ROUTE}:census`, 'census: this task is never answered'],
  'web': ['--port', '0', '--no-open', '--host', '127.0.0.1'],
  'acp': [],
  'sdk': [],
  'sdk-minimal': [],
}

const [template = ''] = process.argv.slice(2)
const args = ARGS[template]
if (args === undefined) throw new Error(`P1-01 census: no arguments for template ${JSON.stringify(template)}`)

const cwd = mkdtempSync(join(tmpdir(), 'p1-01-census-cwd-'))
const patchFiles: string[] = []
if (template === 'headless') {
  const overlay = join(cwd, 'hang-llm.patch.yml')
  writeFileSync(overlay, [
    '- insert:',
    '    - id: p1-01-census-hang-llm',
    `      name: '${fileURLToPath(new URL('./hang-llm.ts', import.meta.url))}'`,
    '',
  ].join('\n'))
  patchFiles.push(overlay)
}

let ctx: Context | undefined
let bootError: string | undefined
try {
  ctx = (await runProfile({
    environment: loadLayeredEnv('dsh', cwd),
    profile: template,
    fromDefaultProfile: undefined,
    patchFiles,
    args,
  })).ctx
} catch (error) {
  bootError = error instanceof Error ? error.message : String(error)
}
const path = featureGateShadowLogPath()
const records: unknown[] = existsSync(path)
  ? readFileSync(path, 'utf8').split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as unknown)
  : []
process.stdout.write(`P1-01-CENSUS ${JSON.stringify({
  template,
  bootError: bootError ?? null,
  treeActive: ctx?.fiber.state === FiberState.ACTIVE,
  records,
})}\n`)
if (ctx !== undefined) await ctx.fiber.dispose()
process.exit(0)
