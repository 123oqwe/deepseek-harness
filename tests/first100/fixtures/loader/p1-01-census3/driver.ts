#!/usr/bin/env node
/**
 * CENSUS-3 (never merge; 4i1b step 3, gate3 2026-10-04T05:54:49Z Q3): boot one
 * shipped profile template through the shipped `runProfile`, at the gate's
 * shipped default (`shadow`), with one more patch layer that mounts one group
 * of the published packages users mount by a patch row. This commit gives each
 * of those packages an empty placeholder Manifest v2, so the post-mount
 * comparison judges each such entry by its own empty manifest and the shadow
 * record names every tool, ctx key and event the package registered as an
 * undeclared registration.
 *
 * The rows are the ones the shipped examples and the recorded scenarios mount
 * (snapshots/session/text-turn, lsp-definition, pty-tools-sandbox-backend,
 * persistent-pwsh-tool-turn, session-query-spill, session-reference-spill,
 * subagent-acp-diagnostic, subagent-child-question-rejection,
 * cordis-inspect-jsdoc; snapshots/sdk/subagent-dsh-sdk-dynamic-route;
 * apps/cli/config/examples/github-review), with fixture-only rows left out.
 *
 * Prints one `P1-01-CENSUS3 <json>` line, then disposes the tree and exits 0.
 * @module tests/first100/fixtures/loader/p1-01-census3/driver
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Context, FiberState } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { featureGateShadowLogPath, runProfile } from '../../../../../apps/cli/src/profile-boot.ts'
import { CENSUS_ROUTE } from './hang-llm.ts'
import { GROUPS, type Group } from './groups.ts'

const hangLlm = fileURLToPath(new URL('./hang-llm.ts', import.meta.url))
/** The arguments each template is launched with. */
const ARGS: Readonly<Record<Group['template'], readonly string[]>> = {
  headless: ['--model', `${CENSUS_ROUTE}:census`, 'census: this task is never answered'],
  web: ['--port', '0', '--no-open', '--host', '127.0.0.1'],
  sdk: [],
}

/**
 * Indent one row under an `insert:` list.
 * @param row - a row as YAML list item text.
 * @returns the row indented by four spaces.
 */
function indented(row: string): string {
  return row.split('\n').map(line => `    ${line}`).join('\n')
}

const [groupName = ''] = process.argv.slice(2)
const group = GROUPS[groupName]
if (group === undefined) throw new Error(`P1-01 census 3: no group ${JSON.stringify(groupName)}`)

const cwd = mkdtempSync(join(tmpdir(), 'p1-01-census3-cwd-'))
const rows = group.template === 'headless'
  ? [`- id: p1-01-census-hang-llm\n  name: '${hangLlm}'`, ...group.rows]
  : group.rows
const overlay = join(cwd, 'census3.patch.yml')
writeFileSync(overlay, `- insert:\n${rows.map(indented).join('\n')}\n`)

let ctx: Context | undefined
let bootError: string | undefined
try {
  ctx = (await runProfile({
    environment: loadLayeredEnv('dsh', cwd),
    profile: group.template,
    fromDefaultProfile: undefined,
    patchFiles: [overlay],
    args: ARGS[group.template],
  })).ctx
} catch (error) {
  bootError = error instanceof Error ? error.message : String(error)
}
const path = featureGateShadowLogPath()
const records: unknown[] = existsSync(path)
  ? readFileSync(path, 'utf8').split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as unknown)
  : []
process.stdout.write(`P1-01-CENSUS3 ${JSON.stringify({
  group: groupName,
  template: group.template,
  bootError: bootError ?? null,
  treeActive: ctx?.fiber.state === FiberState.ACTIVE,
  records,
})}\n`)
if (ctx !== undefined) await ctx.fiber.dispose()
process.exit(0)
