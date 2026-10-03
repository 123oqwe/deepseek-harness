/**
 * Driver for B-696, the P0-02 red first on the shipped Desktop Host
 * (BLOCKED-306 condition 1, question 29 (a)).
 *
 * It starts the Desktop Host the way the Electron application does, through
 * `runDesktopHost`, on a desktop project built in this process's working
 * directory, with the built-in desktop bundle list and linked workspace
 * packages allowed. Beside it the driver builds the runtime directory the
 * application carries: `node_modules/@deepseek-ai/dsh` links the dsh package
 * the Desktop Host package depends on, and `@deepseek-ai/dsh-web-frontend`
 * is a stand-in holding only a placeholder `dist/index.html`. The host
 * resolves that file when it starts and serves it only on a page request,
 * which the driver never makes, and the suite runs before any web build.
 *
 * The host hands back no context, so the project's own patch mounts one
 * sentinel plugin that records the root context it was mounted on. Through
 * that context the driver reads whether a Trust Kernel is pinned and calls a
 * read-only probe tool on behalf of the root agent, presenting its session
 * token, through the public `ToolRuntime.execute` seam, as the P0-02
 * no-kernel dispatch driver does. The sentinel declares a Plugin Manifest v2
 * that names nothing, because it registers nothing.
 * @module tests/first100/fixtures/loader/p0-02-desktop-host/driver
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-capability-token'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-trust-kernel'
import { runDesktopHost } from '../../../../../apps/desktop-host/src/index.ts'
import { MockAdapter, textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import {
  DESKTOP_PROJECTS,
  type DesktopHostReport,
  type DesktopProject,
  PROBE_CALL_ID,
  PROBE_TOOL,
  REPORT_PREFIX,
} from './shared.ts'

const PROVIDER = 'p0-02-desktop-host-mock'
const ROOT_KEY = Symbol.for('b696.desktop-root')
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

/**
 * Whether a command-line word names a desktop project.
 * @param value - the word.
 * @returns whether it is one of {@link DESKTOP_PROJECTS}.
 */
function isDesktopProject(value: string | undefined): value is DesktopProject {
  return DESKTOP_PROJECTS.some(project => project === value)
}

const project = process.argv[2]
if (!isDesktopProject(project)) throw new Error('p0-02 desktop-host driver requires a desktop project name')

const sentinelDir = join(process.cwd(), 'desktop-sentinel')
mkdirSync(sentinelDir, { recursive: true })
writeFileSync(join(sentinelDir, 'package.json'), `${JSON.stringify({
  name: 'p0-02-desktop-sentinel',
  version: '1.0.0',
  type: 'module',
  main: './index.mjs',
  dsh: { manifestVersion: 2, executionMode: 'in-process', compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' } },
}, undefined, 2)}\n`)
writeFileSync(join(sentinelDir, 'index.mjs'), [
  'export const name = \'p0-02-desktop-sentinel\'',
  'export function apply(ctx) { globalThis[Symbol.for(\'b696.desktop-root\')] = ctx.root }',
  '',
].join('\n'))

const projectDir = join(process.cwd(), 'desktop-project')
mkdirSync(projectDir, { recursive: true })
writeFileSync(join(projectDir, 'package.json'), `${JSON.stringify({
  name: 'p0-02-desktop-project',
  private: true,
  version: '0.0.0',
  dependencies: {},
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      ...project === 'insecure-development' ? { development: true } : {},
    },
  },
}, undefined, 2)}\n`)
writeFileSync(
  join(projectDir, 'cordis.patch.yml'),
  `- insert:\n    - id: p0-02-desktop-sentinel\n      name: '${pathToFileURL(join(sentinelDir, 'index.mjs')).href}'\n`,
)

const runtimeDir = join(process.cwd(), 'desktop-runtime')
const runtimeScope = join(runtimeDir, 'node_modules', '@deepseek-ai')
mkdirSync(runtimeScope, { recursive: true })
writeFileSync(join(runtimeDir, 'package.json'), `${JSON.stringify({ name: 'p0-02-desktop-runtime', private: true, version: '0.0.0' }, undefined, 2)}\n`)
symlinkSync(realpathSync(join(repoRoot, 'apps', 'desktop-host', 'node_modules', '@deepseek-ai', 'dsh')), join(runtimeScope, 'dsh'), 'junction')
const frontendDir = join(runtimeScope, 'dsh-web-frontend')
mkdirSync(join(frontendDir, 'dist'), { recursive: true })
writeFileSync(join(frontendDir, 'package.json'), `${JSON.stringify({ name: '@deepseek-ai/dsh-web-frontend', private: true, version: '0.0.0' }, undefined, 2)}\n`)
writeFileSync(join(frontendDir, 'dist', 'index.html'), '<!doctype html>\n<title>p0-02 desktop runtime</title>\n')

/**
 * Print one report line for the spec to parse.
 * @param report - the report.
 */
function print(report: DesktopHostReport): void {
  process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify(report)}\n`)
}

const controller = await runDesktopHost(runtimeDir, projectDir, () => Promise.resolve(), { allowLinkedPackages: true })
  .catch((error: unknown) => {
    print({ project, refused: error instanceof Error ? error.message : String(error), runs: [] })
    return undefined
  })
if (controller === undefined) process.exit(0)

try {
  const ctx = (globalThis as unknown as Record<symbol, Context | undefined>)[ROOT_KEY]
  if (ctx === undefined) throw new Error('p0-02 desktop-host driver: the sentinel never mounted')
  const runs: string[] = []
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a probe that reads nothing and records that it ran',
    riskDomainTags: ['filesystem-read'],
    parameters: {
      note: { type: 'string', required: true, description: 'Free text; the probe ignores it.' },
    },
    execute: (_args, exec) => {
      runs.push(String(exec.callId))
      return Promise.resolve([{ type: 'text' as const, text: 'probe ran' }])
    },
  }))
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 4 }, () => textResponse('ok'))))
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const root = ctx.agents.list()[0]
  if (root === undefined) throw new Error('p0-02 desktop-host driver: no root agent after creation')
  const tokens = ctx.get('capabilityTokens')
  const capabilityToken = tokens === undefined ? undefined : await tokens.whenSessionToken(root.id)
  let call: NonNullable<DesktopHostReport['call']>
  try {
    const result = await ctx.tools.execute({
      callId: brandString<ToolCallId>(PROBE_CALL_ID),
      name: PROBE_TOOL,
      arguments: { note: 'from a plugin' },
      agent: root,
      ...capabilityToken === undefined ? {} : { capabilityToken },
      signal: new AbortController().signal,
    })
    call = { isError: result.isError, text: result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') }
  } catch (error: unknown) {
    call = { thrown: error instanceof Error ? error.message : String(error) }
  }
  print({ project, kernel: ctx.get('trustKernel') !== undefined, runs, call })
} finally {
  await controller.dispose()
}
