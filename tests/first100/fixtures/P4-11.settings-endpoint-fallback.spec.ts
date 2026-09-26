/**
 * A-499 (fix B-646) under P4-11: a user's `settings.yaml` `llm-deepseek` section
 * that sets a valid `baseURL` (service A) AND carries the removed
 * `retryPolicy.retryableCodes` field makes the request silently go to the bundle
 * default endpoint (service B), with no user-facing error — the whole section,
 * including the valid `baseURL`, is discarded.
 *
 * DEPENDS ON B-605 (`3906a7fb4a`): B-605 removes `retryableCodes` and adds a
 * runtime rejection (`retry-policy.ts` `if ('retryableCodes' in config) throw
 * '…retryableCodes is not accepted…'`). The red case only fires on a tree that
 * INCLUDES B-605; on a pre-B-605 tree `retryableCodes` is still a valid key, the
 * section is accepted, and the request goes to A (this case would be green). The
 * dispatch parent MUST include B-605.
 *
 * Mechanism (read on the B-605 tree): the deepseek provider resolves its
 * endpoint from `config.baseURL ?? $DEEPSEEK_BASE_URL ?? PUBLIC_BASE_URL`
 * (`llm-deepseek/src/index.ts:394-396`). `current()` starts as the plugin/bundle
 * config B (`:422`); a settings snapshot whose resolution throws is caught and
 * the last good config (B) is kept, with only two `ctx.logger.error` lines
 * (`:435-440`) — not fail-loud. The removed `retryableCodes` makes
 * `resolveRetryPolicy` throw (`:417`), so the section is discarded and B stays in
 * force.
 *
 * No real network: A and B are local mock chat-completions servers.
 * @module tests/first100/fixtures/P4-11.settings-endpoint-fallback
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { assemble } from '../../../packages/llm/llm-deepseek/tests/assemble.ts'
import { closeMockServers, mockServer, textEvents } from '../../../packages/llm/llm-deepseek/tests/mock-server.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  await closeMockServers()
  vi.unstubAllEnvs()
})

/**
 * Boot llm + settings-file + llm-deepseek over a temp home, with `settings.yaml`
 * already written (loaded at init) and the bundle baseURL set to `bundleBaseURL`.
 */
async function boot(settingsYaml: string, bundleBaseURL: string): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-a499-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', dir)
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
  await writeFile(join(dir, 'settings.yaml'), settingsYaml)
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  const settingsFiber = ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await settingsFiber
  await ctx.plugin(LlmDeepSeek, { baseURL: bundleBaseURL })
  return ctx
}

describe('P4-11 / B-646: an invalid settings section must not silently redirect the request to the bundle endpoint', () => {
  it('control: a valid settings baseURL (service A) overrides the bundle default (service B)', async () => {
    const serverA = await mockServer([{ kind: 'sse', events: textEvents }])
    const serverB = await mockServer([{ kind: 'sse', events: textEvents }])
    const ctx = await boot(`llm-deepseek:\n  baseURL: ${serverA.url}\n`, serverB.url)

    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(serverA.requests.length, 'the request used the settings baseURL A').toBe(1)
    expect(serverB.requests.length, 'the bundle default B was not used').toBe(0)
  })

  it('red: a settings section with a valid baseURL A AND the removed retryableCodes sends the request to A or errors clearly', async () => {
    const serverA = await mockServer([{ kind: 'sse', events: textEvents }])
    const serverB = await mockServer([{ kind: 'sse', events: textEvents }])
    // The user's settings.yaml: a valid baseURL plus the removed per-provider code list.
    const ctx = await boot(
      `llm-deepseek:\n  baseURL: ${serverA.url}\n  retryPolicy:\n    mode: normal\n    retryableCodes:\n      - "500"\n`,
      serverB.url,
    )

    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    // Requirement (a disjunction): the request goes to the settings baseURL A,
    // OR dsh refuses with a clear error. The one assertion that is red on the
    // bug and green after EITHER acceptable fix is that the request did NOT
    // silently succeed against the bundle default B. Bug (B-605 tree): the whole
    // section — including the valid baseURL A — is discarded, and the request
    // silently goes to B.
    expect(
      serverB.requests.length,
      `the request must not silently fall back to the bundle default B; finish=${JSON.stringify(result.finish)}, A=${serverA.requests.length}`,
    ).toBe(0)
  })
})
