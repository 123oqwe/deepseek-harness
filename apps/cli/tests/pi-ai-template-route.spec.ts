/**
 * P9-02 Usage — one settings fragment, no code change, a real run.
 *
 * acceptance[0] is a claim about what a DEPLOYMENT has to do, not about what a
 * function returns: write a `llm-pi-ai:` section into `settings.yaml`, change no
 * code, and a headless task completes over an OpenAI-compatible gateway. Every
 * layer between the fragment and the request has to hold for that to be true —
 * the settings document is read, the section registers a live route, the
 * template's fields become a pi-ai provider, the credential resolves from the
 * environment, and the protocol conversion produces a request the gateway
 * answers. A unit test can show any one of those and none of them together.
 *
 * So the gateway here is a real local HTTP server speaking the
 * chat-completions wire format, and the profile is written by
 * `instantiateTemplate` — the same function a user would reach for — rather
 * than by hand.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

import { instantiateTemplate } from '@deepseek-ai/dsh-llm-pi-ai/src/templates.ts'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BIN_SCRIPT = join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')
const TSCONFIG = join(REPOSITORY_ROOT, 'tsconfig.json')
const ROUTE = 'mock-gateway'
const MODEL = 'mock-model'
const KEY_ENV = 'P9_02_GATEWAY_KEY'

/** One server-sent-events response body in the chat-completions dialect. */
function sse(lines: readonly string[]): string {
  return `${lines.map(line => `data: ${line}`).join('\n\n')}\n\n`
}

/** A response that asks for one shell command. */
function toolCallResponse(index: number): string {
  const args = JSON.stringify({ command: `echo step-${String(index)}`, description: `Step ${String(index)}.` })
  return sse([
    JSON.stringify({ choices: [{ delta: { role: 'assistant' }, index: 0, finish_reason: null }] }),
    JSON.stringify({
      choices: [{
        delta: { tool_calls: [{ index: 0, id: `call-${String(index)}`, type: 'function', function: { name: 'bash', arguments: args } }] },
        index: 0,
        finish_reason: null,
      }],
    }),
    JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
    '[DONE]',
  ])
}

/** The final answer, after the tool rounds. */
const FINAL_TEXT = 'GATEWAY RUN COMPLETE'
const finalResponse = sse([
  JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] }),
  JSON.stringify({ choices: [{ delta: { content: FINAL_TEXT }, index: 0, finish_reason: null }] }),
  JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 3 } }),
  '[DONE]',
])

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

/** Start the stand-in gateway: three tool rounds, then an answer. */
async function startGateway(): Promise<{ url: string; authorizations: (string | undefined)[]; requestCount: () => number }> {
  const authorizations: (string | undefined)[] = []
  let served = 0
  const server = createServer((request, response) => {
    authorizations.push(request.headers.authorization)
    // Drain the body: an unread request stream keeps the socket busy.
    request.resume()
    request.on('end', () => {
      served += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(served <= 3 ? toolCallResponse(served) : finalResponse)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('gateway did not bind a port')
  return { url: `http://127.0.0.1:${String(address.port)}/v1`, authorizations, requestCount: () => served }
}

/**
 * Write the profile and the ONE settings fragment this case is about.
 * @param cwd - the smoke's isolated working directory.
 * @param gatewayUrl - the stand-in gateway's base URL.
 * @param corrupt - optional edit applied to the profile before it is written, for the fault cases.
 */
function stage(cwd: string, gatewayUrl: string, corrupt?: (profile: Record<string, unknown>) => void): void {
  const home = join(cwd, '.dsh')
  const profileDir = join(home, 'profiles', 'headless')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-headless',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'], patchReload: 'startup' } },
  }, undefined, 2)}\n`)
  // The profile patch disables the shipped DeepSeek route and relocates
  // sessions. It configures NO route: if it did, this case would no longer be
  // about what a settings fragment alone can do.
  writeFileSync(join(profileDir, 'cordis.patch.yml'), [
    '- id: llm-deepseek',
    '  disabled: true',
    '',
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: './.sessions'",
    '',
  ].join('\n'))
  const profile = instantiateTemplate('openai-completions', {
    baseURL: gatewayUrl,
    model: MODEL,
    apiKeyEnv: KEY_ENV,
  })
  // The settings document the web Models page writes. The profile is SERIALIZED
  // whole rather than transcribed field by field: a hand-written fragment would
  // restate what the template is supposed to supply, and a template that
  // stopped supplying one — its model list, say — would leave this case green
  // because the fixture had quietly provided it instead.
  // Written as JSON, which YAML parses: it avoids a serializer dependency in
  // this package and keeps the fragment mechanically derived from the profile.
  const written: Record<string, unknown> = { ...profile }
  corrupt?.(written)
  writeFileSync(join(home, 'settings.yaml'), `${JSON.stringify({ 'llm-pi-ai': { providers: { [ROUTE]: written } } }, undefined, 2)}\n`)
}

describe('P9-02 Usage — a settings fragment alone activates a template route', () => {
  it('acceptance[0]: a headless task completes over a mock gateway after three tool calls', async () => {
    const gateway = await startGateway()
    const result = await runLoaderSmoke({
      label: 'p9-02-gateway',
      tempDirPrefix: 'dsh-p9-02-gateway-',
      binScript: BIN_SCRIPT,
      configPath: '',
      binArgs: ['--profile', 'headless', '--model', `${ROUTE}:${MODEL}`, 'use the gateway'],
      tsconfigPath: TSCONFIG,
      env: {
        DSH_TRUST_KERNEL_INSECURE: '1',
        DSH_TELEMETRY_DISABLED: '1',
        [KEY_ENV]: 'p9-02-key-from-the-environment',
      },
      prepare: (cwd) => { stage(cwd, gateway.url) },
    })
    expect(result.stdout).toContain(FINAL_TEXT)
    // Four requests: three tool rounds and the answer. Fewer would mean the
    // run stopped early; the count is the "≥3 tool calls" half of the clause.
    expect(gateway.requestCount()).toBeGreaterThanOrEqual(4)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('must[2]: the key reaches the gateway from the environment, and only from there', async () => {
    const gateway = await startGateway()
    await runLoaderSmoke({
      label: 'p9-02-credential',
      tempDirPrefix: 'dsh-p9-02-credential-',
      binScript: BIN_SCRIPT,
      configPath: '',
      binArgs: ['--profile', 'headless', '--model', `${ROUTE}:${MODEL}`, 'use the gateway'],
      tsconfigPath: TSCONFIG,
      env: {
        DSH_TRUST_KERNEL_INSECURE: '1',
        DSH_TELEMETRY_DISABLED: '1',
        [KEY_ENV]: 'p9-02-key-from-the-environment',
      },
      prepare: (cwd) => { stage(cwd, gateway.url) },
      inspect: (cwd) => {
        // The settings document names the variable and never holds the value.
        const settings = readFileSync(join(cwd, '.dsh', 'settings.yaml'), 'utf8')
        expect(settings).toContain(KEY_ENV)
        expect(settings).not.toContain('p9-02-key-from-the-environment')
      },
    })
    expect(gateway.authorizations[0]).toContain('p9-02-key-from-the-environment')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

/**
 * P9-02 Fault — a settings fragment the deployment cannot serve.
 *
 * must[1] asks for fail-closed with a message naming the field. The Contract
 * cases pin that for what a template REFUSES TO BUILD; these pin it for what a
 * user can still write by hand into the settings document afterwards, which is
 * the path a template cannot guard — the file is theirs to edit.
 *
 * The run must not fall through to some other route. There is no other route
 * here (the shipped one is disabled), so a non-zero exit with nothing on stdout
 * is what "closed" means.
 */
describe('P9-02 Fault — an unserviceable settings fragment stops the run', () => {
  it('a protocol name nothing implements is refused, naming the route', async () => {
    const gateway = await startGateway()
    const result = await runLoaderSmoke({
      label: 'p9-02-bad-protocol',
      tempDirPrefix: 'dsh-p9-02-bad-protocol-',
      binScript: BIN_SCRIPT,
      configPath: '',
      binArgs: ['--profile', 'headless', '--model', `${ROUTE}:${MODEL}`, 'use the gateway'],
      tsconfigPath: TSCONFIG,
      env: { DSH_TRUST_KERNEL_INSECURE: '1', DSH_TELEMETRY_DISABLED: '1', [KEY_ENV]: 'unused' },
      prepare: (cwd) => { stage(cwd, gateway.url, (profile) => { profile['api'] = 'not-a-wire-protocol' }) },
      expectedExitCode: 1,
    })
    expect(result.stderr).toContain(ROUTE)
    expect(result.stdout).not.toContain(FINAL_TEXT)
    // Nothing was sent anywhere: a refused route must not reach an endpoint.
    expect(gateway.requestCount()).toBe(0)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('a credential reference whose variable is unset fails the request rather than sending an empty key', async () => {
    const gateway = await startGateway()
    const result = await runLoaderSmoke({
      label: 'p9-02-missing-key',
      tempDirPrefix: 'dsh-p9-02-missing-key-',
      binScript: BIN_SCRIPT,
      configPath: '',
      binArgs: ['--profile', 'headless', '--model', `${ROUTE}:${MODEL}`, 'use the gateway'],
      tsconfigPath: TSCONFIG,
      // The variable the fragment names is deliberately absent from this env.
      env: { DSH_TRUST_KERNEL_INSECURE: '1', DSH_TELEMETRY_DISABLED: '1' },
      prepare: (cwd) => { stage(cwd, gateway.url) },
      // 4, not 1: the route mounts and the run STARTS, then the request fails
      // to resolve its credential, so the turn ends with an error reason and
      // the scriptable map (P9-06 must[3]) gives errors their own code. Exit 1
      // is the unknown-outcome code, and expecting it here would have been
      // expecting the run to fail in a way it explicitly classifies.
      expectedExitCode: 4,
    })
    expect(result.stdout).not.toContain(FINAL_TEXT)
    // An unauthenticated request would have been the silent failure: the
    // gateway would answer, and only a 401 from a real provider would say why.
    expect(gateway.authorizations.every(header => header === undefined || !header.includes('Bearer '))).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
