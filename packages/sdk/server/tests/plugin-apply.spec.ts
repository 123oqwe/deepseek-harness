import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrackedContexts } from '@deepseek-ai/dsh-agent-loop-testkit'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
// The control-plane merges: `ctx.controlPlane` as a provide target and
// `control/state-changed` as a typed emit. Type-only, like the server's own.
import type {} from '@deepseek-ai/dsh-control-plane/plugin'
import type { SdkHostControlState } from '@deepseek-ai/dsh-sdk-protocol'
import * as jsonrpc from '../src/index.ts'

/**
 * Mount the real namespace plugin with in-memory stdio and exit hooks. Covers
 * the full transport/server path, response-before-exit shutdown exactly once,
 * and bare-fiber disposal without process exit.
 */

/** One ordered frame, write completion, or exit observation. */
type WireEvent =
  | { kind: 'frame'; frame: Record<string, unknown> }
  | { kind: 'write-complete'; ids: (string | number)[] }
  | { kind: 'root-disposed' }
  | { kind: 'exit'; code: number }

interface ApplyHarness {
  ctx: Context
  /** The plugin fiber used by the bare-dispose case. */
  fiber: Awaited<ReturnType<Context['plugin']>>
  /** Frames, write completions, and exits in observation order. */
  events: WireEvent[]
  outputErrors: Error[]
  send(frame: Record<string, unknown>): void
  sendRaw(text: string): void
  frames(): Record<string, unknown>[]
  exits(): number[]
  waitForFrame(predicate: (frame: Record<string, unknown>) => boolean, description: string): Promise<Record<string, unknown>>
  dispose(): Promise<void>
}

/** Adapter whose route registration is the delayed Loader entry's readiness fact. */
class DelayedAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not exercised')
  }
}

/** Poll asynchronous output for up to five seconds. */
async function waitFor<T>(get: () => T | undefined, description: string): Promise<T> {
  const deadline = Date.now() + 5000
  for (;;) {
    const value = get()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** Drain asynchronous work before a negative assertion. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25))
}

/** Mount the real plugin on a minimal harness with in-memory stdio and exit. */
async function mountPlugin(
  storageDir: string,
  options: {
    writeDelayMs?: number
    failFlush?: boolean
    beforeServer?: (ctx: Context) => Promise<void> | void
  } = {},
): Promise<ApplyHarness> {
  const ctx = contexts.track(new Context())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root: storageDir })
  await new Promise(resolve => setTimeout(resolve, 50))
  await options.beforeServer?.(ctx)

  const input = new PassThrough()
  const events: WireEvent[] = []
  const outputErrors: Error[] = []
  let pendingOutput = ''
  // Record frame admission separately from write completion so delayed output
  // tests the flush barrier.
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const ids: (string | number)[] = []
      pendingOutput += chunk.toString('utf8')
      for (;;) {
        const newline = pendingOutput.indexOf('\n')
        if (newline < 0) break
        const line = pendingOutput.slice(0, newline).trim()
        pendingOutput = pendingOutput.slice(newline + 1)
        if (line) {
          const frame = JSON.parse(line) as Record<string, unknown>
          events.push({ kind: 'frame', frame })
          if (typeof frame.id === 'string' || typeof frame.id === 'number') ids.push(frame.id)
        }
      }
      const complete = (): void => {
        if (options.failFlush === true && chunk.length === 0) {
          callback(new Error('flush callback failed'))
          return
        }
        events.push({ kind: 'write-complete', ids })
        callback()
      }
      if ((options.writeDelayMs ?? 0) > 0) setTimeout(complete, options.writeDelayMs)
      else complete()
    },
  })
  output.on('error', (error: Error) => { outputErrors.push(error) })
  const exit = (code: number): void => { events.push({ kind: 'exit', code }) }

  ctx.effect(() => () => { events.push({ kind: 'root-disposed' }) }, 'jsonrpc test root-disposal witness')
  const fiber = await ctx.plugin(jsonrpc, {
    input,
    output,
    exit,
  })

  const frames = (): Record<string, unknown>[] =>
    events.flatMap(event => event.kind === 'frame' ? [event.frame] : [])
  return {
    ctx,
    fiber,
    events,
    outputErrors,
    send: (frame) => { input.write(`${JSON.stringify(frame)}\n`) },
    sendRaw: (text) => { input.write(text) },
    frames,
    exits: () => events.flatMap(event => event.kind === 'exit' ? [event.code] : []),
    waitForFrame: (predicate, description) => waitFor(() => frames().find(predicate), description),
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

const servers: Server[] = []

/**
 * Every Context these cases build. This file mounts session persistence over a
 * real directory, so a Context left undisposed is a mount whose durable write
 * nobody awaits (BLOCKED-229/230).
 */
const contexts = new TrackedContexts()

afterEach(async () => {
  // Dispose before anything a mount writes to is removed.
  expect(await contexts.disposeAll()).toEqual([])
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
  vi.unstubAllEnvs()
})

/** Keyless SSE endpoint for completing a prompt turn. */
async function mockCompletionServer(): Promise<{ url: string; requests: unknown[] }> {
  const requests: unknown[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":"done"}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, requests }
}

describe('dsh-sdk-jsonrpc-server plugin apply', () => {
  it('P8-01 must[2]: the server REFUSES an unknown mandatory capability over the real stdio pair', async () => {
    // The provider-stage spec asserts the negotiation FUNCTIONS through the
    // package face. Removing the server's call to them reddened none of those
    // cases, because none of them ran the server. This one does: it drives a
    // real initialize over the injected transport and requires a JSON-RPC
    // error rather than a result.
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-refuse-'))
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    const harness = await mountPlugin(storageDir)
    try {
      harness.send({
        jsonrpc: '2.0',
        id: 'refuse-1',
        method: 'initialize',
        params: {
          cwd: storageDir,
          provider: 'deepseek-official',
          model: 'apply-model',
          capabilities: [{ id: 'teleport', mandatory: true }],
        },
      })
      const response = await harness.waitForFrame(frame => frame.id === 'refuse-1', 'initialize refusal')
      expect(response).toMatchObject({ id: 'refuse-1', error: { message: expect.stringContaining('teleport') as string } })
      expect('result' in response).toBe(false)
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('P8-01 acceptance[0]: the server REFUSES a peer whose protocol range does not overlap its own', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-range-'))
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    const harness = await mountPlugin(storageDir)
    try {
      harness.send({
        jsonrpc: '2.0',
        id: 'range-1',
        method: 'initialize',
        params: {
          cwd: storageDir,
          provider: 'deepseek-official',
          model: 'apply-model',
          protocolVersions: { min: 99, max: 99 },
        },
      })
      const response = await harness.waitForFrame(frame => frame.id === 'range-1', 'initialize range refusal')
      expect(response).toMatchObject({ id: 'range-1', error: { message: expect.stringContaining('no-overlapping-version') as string } })
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('serves initialize over the injected stdio pair', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-init-'))
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    const harness = await mountPlugin(storageDir)
    try {
      harness.send({ jsonrpc: '2.0', id: 'init-1', method: 'initialize', params: { cwd: storageDir, provider: 'deepseek-official', model: 'apply-model' } })

      const response = await harness.waitForFrame(frame => frame.id === 'init-1', 'initialize response')
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
          // P8-01: the handshake now also returns what the peers agreed to.
          // Asserted in full rather than loosened to a partial match: this
          // case pins the exact wire reply, and relaxing it would stop it
          // catching the next field that appears or vanishes.
          negotiation: {
            protocolVersion: 1,
            agreedCapabilities: [],
            ignoredCapabilities: [],
            downgrades: [],
          },
          protocolVersions: { min: 1, max: 1 },
          schemaFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u) as string,
        },
      })
      expect(harness.exits()).toEqual([])
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('waits for Loader-owned adapter registration before initialize', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-readiness-'))
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const ready = new Promise<void>((resolve) => { release = resolve })
    let delayedEntry: Promise<string> | undefined
    const harness = await mountPlugin(storageDir, {
      beforeServer: async (ctx) => {
        await ctx.plugin(Loader)
        ctx.loader.builtins['delayed-readiness'] = {
          inject: ['llm'],
          async apply(entryCtx: Context) {
            markStarted()
            await ready
            entryCtx.llm.registerAdapter(['delayed-private'], new DelayedAdapter())
          },
        }
        delayedEntry = ctx.loader.create({ name: 'cordis:delayed-readiness' })
        await started
      },
    })
    try {
      const initialize = {
        jsonrpc: '2.0',
        id: 'init-delayed',
        method: 'initialize',
        params: { cwd: storageDir, provider: 'delayed-private', model: 'apply-model' },
      }
      const probe = { jsonrpc: '2.0', id: 'probe-during-delay', method: 'nope/unknown' }
      harness.sendRaw(`${JSON.stringify(initialize)}\n${JSON.stringify(probe)}\n`)

      // The transport processes independent requests concurrently. Receiving
      // this later probe proves the preceding initialize handler has reached
      // its Loader wait, without relying on a scheduler delay.
      await harness.waitForFrame(frame => frame.id === 'probe-during-delay', 'probe while initialize waits')
      expect(harness.frames().some(frame => frame.id === 'init-delayed')).toBe(false)

      release()
      await delayedEntry
      const response = await harness.waitForFrame(frame => frame.id === 'init-delayed', 'initialize response after Loader settlement')
      expect(response).toMatchObject({
        id: 'init-delayed',
        result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' } },
      })
      expect(harness.ctx.llm.listProviders()).toContainEqual({ id: 'delayed-private', name: 'delayed-private' })
    } finally {
      release()
      await Promise.allSettled(delayedEntry === undefined ? [] : [delayedEntry])
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('drives a session/prompt turn end-to-end and forwards session notifications as output frames', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-prompt-'))
    const llmServer = await mockCompletionServer()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    vi.stubEnv('DEEPSEEK_BASE_URL', llmServer.url)
    const harness = await mountPlugin(storageDir)
    try {
      harness.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { cwd: storageDir, provider: 'deepseek-official', model: 'dsagent-model' } })
      await harness.waitForFrame(frame => frame.id === 1, 'initialize response')

      harness.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        params: { sessionId: 'main', contentBlocks: [{ type: 'text', text: 'fix it' }] },
      })
      const response = await harness.waitForFrame(frame => frame.id === 2, 'prompt response')
      expect((response.result as { messageId?: unknown }).messageId).toBeTypeOf('string')
      await harness.waitForFrame(
        frame => frame.method === 'session.status'
          && (frame.params as { status?: string } | undefined)?.status === 'idle',
        'idle session status',
      )

      expect(llmServer.requests).toHaveLength(1)
      const body = llmServer.requests[0] as { model: string; messages: { role: string }[] }
      expect(body.model).toBe('dsagent-model')
      expect(body.messages.at(-1)?.role).toBe('user')

      // Notifications use the same transport and arrive as id-less frames.
      const notifications = harness.frames().filter(frame => frame.id === undefined)
      expect(notifications.some(frame => frame.method === 'session.event')).toBe(true)
      expect(notifications.findLast(frame => frame.method === 'session.status')).toMatchObject({
        jsonrpc: '2.0',
        params: { sessionId: 'main', status: 'idle' },
      })
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('answers shutdown before exiting 0 exactly once, even against a racing second shutdown', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-shutdown-'))
    const harness = await mountPlugin(storageDir, { writeDelayMs: 10 })
    try {
      // One chunk makes the two deferred exit callbacks race.
      const first = { jsonrpc: '2.0', id: 'sd-1', method: 'shutdown' }
      const second = { jsonrpc: '2.0', id: 'sd-2', method: 'shutdown' }
      harness.sendRaw(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`)

      await waitFor(() => harness.exits().length > 0 ? true : undefined, 'exit recorder call')
      expect(harness.exits()).toEqual([0])

      // Both response writes and the flush barrier complete before exit.
      const exitIndex = harness.events.findIndex(event => event.kind === 'exit')
      const firstResponse = harness.events.findIndex(event => event.kind === 'frame' && event.frame.id === 'sd-1')
      const secondResponse = harness.events.findIndex(event => event.kind === 'frame' && event.frame.id === 'sd-2')
      const firstComplete = harness.events.findIndex(event => event.kind === 'write-complete' && event.ids.includes('sd-1'))
      const secondComplete = harness.events.findIndex(event => event.kind === 'write-complete' && event.ids.includes('sd-2'))
      const flushComplete = harness.events.findIndex(event => event.kind === 'write-complete' && event.ids.length === 0)
      const rootDisposed = harness.events.findIndex(event => event.kind === 'root-disposed')
      expect(firstResponse).toBeGreaterThanOrEqual(0)
      expect(secondResponse).toBeGreaterThanOrEqual(0)
      expect(firstComplete).toBeGreaterThan(firstResponse)
      expect(secondComplete).toBeGreaterThan(secondResponse)
      expect(flushComplete).toBeGreaterThan(firstComplete)
      expect(flushComplete).toBeGreaterThan(secondComplete)
      expect(rootDisposed).toBeGreaterThan(flushComplete)
      expect(exitIndex).toBeGreaterThan(rootDisposed)

      await settle()
      expect(harness.exits()).toEqual([0])
      expect(harness.events.filter(event => event.kind === 'root-disposed')).toHaveLength(1)

      const before = harness.frames().length
      harness.send({ jsonrpc: '2.0', id: 'after-exit', method: 'initialize', params: { cwd: storageDir, provider: 'deepseek-official', model: 'x' } })
      await settle()
      expect(harness.frames().length).toBe(before)
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('still disposes and exits once when the flush callback fails', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-flush-failure-'))
    const harness = await mountPlugin(storageDir, { failFlush: true })
    try {
      harness.send({ jsonrpc: '2.0', id: 'sd-fail', method: 'shutdown' })

      await waitFor(() => harness.exits().length > 0 ? true : undefined, 'exit after flush failure')
      await settle()
      expect(harness.exits()).toEqual([0])
      expect(harness.events.filter(event => event.kind === 'root-disposed')).toHaveLength(1)
      expect(harness.outputErrors.map(error => error.message)).toEqual(['flush callback failed'])

      const before = harness.frames().length
      harness.send({ jsonrpc: '2.0', id: 'after-flush-failure', method: 'initialize', params: { cwd: storageDir, provider: 'deepseek-official', model: 'x' } })
      await settle()
      expect(harness.frames().length).toBe(before)
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('stops serving on a bare fiber dispose (HMR-style unload) without calling exit', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-dispose-'))
    const harness = await mountPlugin(storageDir)
    try {
      // Prove the handler-rejection path is live before disposal.
      harness.send({ jsonrpc: '2.0', id: 'probe-1', method: 'nope/unknown' })
      const error = await harness.waitForFrame(frame => frame.id === 'probe-1', 'error response for unknown method')
      expect(error.error).toMatchObject({
        code: -32603,
        message: 'unknown DeepSeek Harness SDK runtime method: nope/unknown',
      })

      await harness.fiber.dispose()
      expect(harness.events.some(event => event.kind === 'root-disposed')).toBe(false)

      const before = harness.frames().length
      harness.send({ jsonrpc: '2.0', id: 'probe-2', method: 'initialize', params: { cwd: storageDir, provider: 'deepseek-official', model: 'x' } })
      await settle()
      expect(harness.frames().length).toBe(before)
      expect(harness.exits()).toEqual([])
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})

/**
 * A stop this host is under, in the PROTOCOL's vocabulary.
 *
 * `SdkHostControlState` rather than the control plane's own `ControlState`,
 * because that is what these cases assert on the wire and it carries
 * `requestedBy` as a plain string. The control plane brands it, so the two
 * places that hand this to the plane's own types cast; branding it here would
 * mean two dependency edges for a fixture.
 */
const STOPPED: SdkHostControlState = {
  stopped: true,
  record: {
    requestedBy: 'operator-1',
    reason: 'human-requested',
    requestedAtMs: 1_700_000_000_000,
    release: 'explicit-resume',
  },
}

/**
 * A control plane that reports one state and can announce another.
 *
 * Structural, because the server reads exactly two things from this service --
 * `state()` at the handshake and the `control/state-changed` event -- and
 * mounting the real plugin would bring a durable `emergency-stop.json` into a
 * case about what leaves the transport.
 * @param initial - the state the handshake will report.
 * @returns the service double and the emitter that announces a change.
 */
function fakeControlPlane(initial: SdkHostControlState) {
  let current = initial
  return {
    install: (ctx: Context) => { ctx.provide('controlPlane', { state: () => current } as never) },
    announce: (ctx: Context, next: SdkHostControlState) => {
      current = next
      ctx.emit('control/state-changed', next as never)
    },
  }
}

/** Every `host.control` frame seen so far. */
function hostControlFrames(harness: ApplyHarness): Record<string, unknown>[] {
  return harness.frames().filter(frame => frame.method === 'host.control')
}

describe('P2-12 acceptance[3]: the host stop over the SDK protocol', () => {
  it('agrees the capability, answers the state at the handshake, and sends each edge after it', async () => {
    // One case for three steps because the protocol has no way to observe them
    // apart: a client learns the state at `initialize` and the edges after it,
    // and a server that did one without the other would still look correct to
    // a case that checked only its half.
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-host-control-'))
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    const plane = fakeControlPlane(STOPPED)
    const harness = await mountPlugin(storageDir, { beforeServer: plane.install })
    try {
      harness.send({
        jsonrpc: '2.0',
        id: 'hc-1',
        method: 'initialize',
        params: {
          cwd: storageDir,
          provider: 'deepseek-official',
          model: 'apply-model',
          capabilities: [{ id: 'host-control', mandatory: false }],
        },
      })
      const response = await harness.waitForFrame(frame => frame.id === 'hc-1', 'initialize response')
      const result = response.result as Record<string, unknown>
      expect((result.negotiation as { agreedCapabilities: string[] }).agreedCapabilities).toEqual(['host-control'])
      // The handshake carries the state, which is the only thing that can
      // reach a client that connected AFTER the stop was raised.
      expect(result.hostControl).toEqual(STOPPED)

      // The release, then a second stop: two edges, so the case cannot pass on
      // a server that sends one notification and stops listening.
      plane.announce(harness.ctx, { stopped: false })
      plane.announce(harness.ctx, STOPPED)
      const frames = await waitFor(
        () => { const hits = hostControlFrames(harness); return hits.length === 2 ? hits : undefined },
        'two host.control notifications',
      )
      expect(frames.map(frame => (frame.params as { state: SdkHostControlState }).state))
        .toEqual([{ stopped: false }, STOPPED])
      expect(frames.every(frame => frame.jsonrpc === '2.0' && frame.id === undefined)).toBe(true)
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('sends a client that did not ask NOTHING, and tells it nothing on the handshake either', async () => {
    // The leak check in unit form. A capability nobody declared must not
    // widen the wire: an older client meeting `host.control` has no branch for
    // it, and that is what capability negotiation exists to prevent.
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-host-control-silent-'))
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    const plane = fakeControlPlane(STOPPED)
    const harness = await mountPlugin(storageDir, { beforeServer: plane.install })
    try {
      harness.send({
        jsonrpc: '2.0',
        id: 'hc-silent-1',
        method: 'initialize',
        params: { cwd: storageDir, provider: 'deepseek-official', model: 'apply-model' },
      })
      const response = await harness.waitForFrame(frame => frame.id === 'hc-silent-1', 'initialize response')
      // `in`, not a value comparison: `hostControl: undefined` would serialize
      // away on the wire but would mean the server took the branch.
      expect('hostControl' in (response.result as Record<string, unknown>)).toBe(false)

      plane.announce(harness.ctx, { stopped: false })
      await settle()
      expect(hostControlFrames(harness)).toEqual([])
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does NOT agree the capability when the composition mounts no control plane', async () => {
    // `sdk-minimal` is that composition. Agreeing there would hand a client a
    // capability it had been told it holds and would wait on forever -- the
    // failure negotiation exists to make impossible, arrived at by declaring
    // support the process cannot deliver.
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-host-control-absent-'))
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    const harness = await mountPlugin(storageDir)
    try {
      harness.send({
        jsonrpc: '2.0',
        id: 'hc-absent-1',
        method: 'initialize',
        params: {
          cwd: storageDir,
          provider: 'deepseek-official',
          model: 'apply-model',
          capabilities: [{ id: 'host-control', mandatory: false }],
        },
      })
      const response = await harness.waitForFrame(frame => frame.id === 'hc-absent-1', 'initialize response')
      const negotiation = (response.result as Record<string, unknown>).negotiation as {
        agreedCapabilities: string[]
        ignoredCapabilities: string[]
      }
      expect(negotiation.agreedCapabilities).toEqual([])
      // Recorded as ignored rather than dropped: the client can tell "this
      // build does not have it here" from "this build never heard of it".
      expect(negotiation.ignoredCapabilities).toEqual(['host-control'])
      expect('hostControl' in (response.result as Record<string, unknown>)).toBe(false)
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})
