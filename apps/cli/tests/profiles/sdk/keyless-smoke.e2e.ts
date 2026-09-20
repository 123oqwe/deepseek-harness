import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { zstdDecompress } from 'node:zlib'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { startStubModelServer, type StubModelServer } from '@deepseek-ai/dsh-session-snapshot'
import { scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.js'
import { attachedPrincipal, countRecords, persistedHostUserId, readSessionLog } from '../session-log.ts'

const binScript = fileURLToPath(new URL('../../../src/bin.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const decompress = promisify(zstdDecompress)

/** One frame this driver read, kept with its bytes. */
interface ConsumedFrame {
  /** The line as it arrived, for a message that needs more than a type name. */
  readonly raw: string
  /** The same line, parsed. */
  readonly frame: Record<string, unknown>
}

/** What a driving case can say about itself when a wait does not finish. */
interface WaitDiagnostics {
  /** What is being waited for, in the words of whoever waited. */
  readonly waitingFor: string
  /** The child's stderr so far. */
  stderr: () => string
  /** Frames already consumed by earlier waits, newest last, where a driver tracks them. */
  consumed?: () => readonly ConsumedFrame[]
  /** Whether the child is still running, and how it ended if not. */
  child?: () => string
  /** Requests the server sent this driver, by method, in arrival order. */
  serverRequests?: () => readonly string[]
  /** How many times the stand-in model has been asked for a completion. */
  modelRequests?: () => number
}

/**
 * Describe the state a wait timed out in.
 *
 * A bare "timed out waiting for JSON-RPC response" names neither which of a
 * case's four waits stopped nor what the run had done by then, and reading one
 * cost a whole CI round. Everything here is a fact the driver already holds.
 * @param diagnostics - the driving case's view of its own run.
 * @returns a multi-line message for the rejection.
 */
function describeStall(diagnostics: WaitDiagnostics): string {
  const consumed = diagnostics.consumed?.() ?? []
  const events = consumed.flatMap(({ frame }) => {
    if (frame.method !== 'session.event') return []
    const params = frame.params as { event?: { type?: unknown } } | undefined
    return typeof params?.event?.type === 'string' ? [params.event.type] : []
  })
  const last = consumed.at(-1)?.raw
  return [
    `timed out waiting for ${diagnostics.waitingFor}`,
    // Whether the child is still there decides where to look next, and a dead
    // one and a silent one read identically without this: execa SIGKILLs at 35
    // seconds, so a child that died early looks exactly like one that never
    // answered.
    `  child: ${diagnostics.child?.() ?? '(not tracked)'}`,
    `  frames consumed: ${consumed.length}`,
    `  last session.event types: ${events.slice(-8).join(', ') || '(none)'}`,
    // The types alone cannot show an error text carried inside a `tool/result`,
    // which is the payload a stalled tool call would most likely explain itself
    // in.
    `  last frame: ${last === undefined ? '(none)' : last.slice(0, 400)}`,
    `  server->client requests: ${diagnostics.serverRequests?.().join(', ') || '(none)'}`,
    `  stand-in model requests: ${diagnostics.modelRequests?.() ?? '(not tracked)'}`,
    `  stderr: ${diagnostics.stderr() || '(empty)'}`,
  ].join('\n')
}

/**
 * Wait for the first frame matching a predicate, recording what passes by.
 * @param lines - the child's stdout line buffer, consumed as it is read.
 * @param predicate - what this wait is looking for.
 * @param diagnostics - what to say if the wait does not finish.
 * @param onRequest - called for a server-sent request, which must be answered
 *   for the run to continue; the caller decides what to answer and records it.
 * @param onFrame - called for every frame read, with the bytes it arrived as.
 * @returns the matching frame.
 */
function waitForLine(
  lines: string[],
  predicate: (value: Record<string, unknown>) => boolean,
  diagnostics: WaitDiagnostics,
  onRequest: (request: Record<string, unknown>) => void = () => {},
  onFrame: (raw: string, frame: Record<string, unknown>) => void = () => {},
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000
    const poll = (): void => {
      while (lines.length > 0) {
        const line = lines.shift()!
        if (!line.trim()) continue
        try {
          const value = JSON.parse(line) as Record<string, unknown>
          onFrame(line, value)
          // A frame carrying BOTH an id and a method is a request, and this
          // process is the only one that can answer it: leaving it unanswered
          // stalls whatever asked, which looks exactly like a hung turn.
          if (value.id !== undefined && typeof value.method === 'string') onRequest(value)
          if (predicate(value)) {
            resolve(value)
            return
          }
        } catch {
          reject(new Error(`non-JSON stdout from JSON-RPC agent runtime: ${line}`))
          return
        }
      }
      if (Date.now() >= deadline) {
        reject(new Error(describeStall(diagnostics)))
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })
}

/**
 * Run one whole turn of the shipped `sdk` profile against a stand-in model.
 *
 * Launch to shutdown, because the identity question is about what a LAUNCH
 * attaches. One launch per call: this surface cannot continue a session it
 * already persisted, so a second call against the same `$DSH_HOME` is refused
 * rather than resumed (BLOCKED-298).
 * @param dshHome - harness home.
 * @param stub - the stand-in model endpoint, asked how many times it answered.
 * @returns the methods of every request the server sent this driver.
 */
async function runSdkTurn(dshHome: string, stub: StubModelServer): Promise<string[]> {
  const child = execa(process.execPath, ['--import', 'tsx/esm', binScript, '--profile', 'sdk'], {
    cwd: repoRoot,
    env: {
      DSH_HOME: dshHome,
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: 'keyless-smoke-no-call',
      DEEPSEEK_BASE_URL: stub.baseUrl,
    },
    timeout: 35_000,
    killSignal: 'SIGKILL',
    reject: false,
  })
  const lines: string[] = []
  const consumed: ConsumedFrame[] = []
  const serverRequests: string[] = []
  let stdoutBuffer = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8')
    const parts = stdoutBuffer.split('\n')
    stdoutBuffer = parts.pop() ?? ''
    lines.push(...parts)
  })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const diagnostics = (waitingFor: string): WaitDiagnostics => ({
    waitingFor,
    stderr: () => stderr,
    consumed: () => consumed,
    serverRequests: () => serverRequests,
    modelRequests: () => stub.requests.length,
    // Through `nodeChildProcess`, because execa's own `Subprocess` type does
    // NOT carry `ChildProcess`'s fields (`execa@10` subprocess.d.ts:136-138) --
    // it documents that property as the escape hatch for exactly this (:130).
    // The drivers elsewhere in this repository that read `child.exitCode`
    // directly spawn with `node:child_process`, so their spelling does not
    // transfer here even though it reads the same.
    //
    // It was wrong at RUNTIME as well as in the type, and in the direction
    // that misleads: reading two absent properties made every stall report
    // `exited (exitCode=undefined, signal=undefined)` -- a live child
    // described as a dead one, which is worse than saying nothing. Run
    // 35473161135's reports carry that line.
    child: () => {
      const node = child.nodeChildProcess
      return node.exitCode === null && node.signalCode === null
        ? 'still running'
        : `exited (exitCode=${String(node.exitCode)}, signal=${String(node.signalCode)})`
    },
  })
  // Answered, and recorded. Leaving a request unanswered stalls whatever asked
  // and the case dies of a timeout that names nothing; answering it silently
  // would hide that this surface asks at all. The caller asserts the ledger is
  // empty, so a request turns into a named failure instead of either.
  const answerAndRecord = (request: Record<string, unknown>): void => {
    serverRequests.push(String(request.method))
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32_601, message: `this driver answers no server requests: ${String(request.method)}` },
    })}\n`)
  }
  const wait = async (
    waitingFor: string,
    predicate: (value: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> => waitForLine(
    lines,
    predicate,
    diagnostics(waitingFor),
    answerAndRecord,
    (raw, frame) => { consumed.push({ raw, frame }) },
  )
  try {
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { cwd: dshHome, provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    })}\n`)
    const initialized = await wait('the initialize response', value => value.id === 1)
    // A JSON-RPC error answer IS an answer, so the wait above is satisfied by
    // one. Carrying on to `session/prompt` then spends the deadline three
    // times over waiting for a turn that was never going to start: on run
    // 35473161135 the initialize error said `typert-loader` could not import
    // `lib/typert.host.js`, and the case still timed out twice more before
    // saying so.
    if (initialized.error !== undefined) {
      throw new Error(`the sdk runtime refused initialize: ${JSON.stringify(initialized.error)}`)
    }
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId: 'main', contentBlocks: [{ type: 'text', text: 'write the proof file' }] },
    })}\n`)
    const prompted = await wait('the session/prompt response', value => value.id === 2)
    // Same reason as the guard above, and this is the answer run 35475180584
    // actually came back with: `session "main" already exists` (BLOCKED-298).
    // Waiting for `turn/end` after a refusal spends the whole deadline on a
    // turn that was refused before it started.
    if (prompted.error !== undefined) {
      throw new Error(`the sdk runtime refused session/prompt: ${JSON.stringify(prompted.error)}`)
    }
    await wait("the session's turn/end event", (value) => {
      if (value.method !== 'session.event') return false
      const params = value.params as Record<string, unknown> | undefined
      const event = params?.event as Record<string, unknown> | undefined
      return params?.sessionId === 'main' && event?.type === 'turn/end'
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'shutdown' })}\n`)
    await wait('the shutdown response', value => value.id === 3)
    const exit = await child
    expect(exit.exitCode, `signal=${String(exit.signal)}; stderr=${stderr}`).toBe(0)
    return serverRequests
  } finally {
    // No-op after exit; `reject: false` settles on every outcome, so this never races teardown.
    child.kill('SIGKILL')
    await child
  }
}

describe('Python SDK dsh profile keyless smoke', () => {
  it.each([
    { label: 'reports max-token turns with the default mapping config', envValue: undefined, editorEnabled: false },
    { label: 'reports max-token turns with mapping enabled through env', envValue: 'true', editorEnabled: false },
    { label: 'reports max-token turns with mapping disabled through env', envValue: 'false', editorEnabled: false },
    { label: 'allows an explicit patch to enable str_replace_editor', envValue: undefined, editorEnabled: true },
  ])('$label', async ({ envValue, editorEnabled }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-python-sdk-runtime-smoke-'))
    const editorPatch = join(root, 'editor.patch.yml')
    if (editorEnabled) await writeFile(editorPatch, [
      '- insert:',
      '    - id: tool-str-replace-editor',
      "      name: '@deepseek-ai/dsh-tool-str-replace-editor'",
      '',
    ].join('\n'))
    const modelRequests: Record<string, unknown>[] = []
    const modelServer = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        modelRequests.push(JSON.parse(body) as Record<string, unknown>)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n')
        response.write('data: {"choices":[{"delta":{"content":"done"}}]}\n\n')
        response.write('data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n')
        response.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve))
    const address = modelServer.address()
    if (address === null || typeof address === 'string') throw new Error('model server did not bind a TCP port')
    // The line-predicate protocol driving below is the genuinely custom part;
    // execa owns spawn, the deadline, and exit settlement around it.
    const child = execa(process.execPath, [
      '--import',
      'tsx/esm',
      binScript,
      '--profile',
      'sdk',
      ...(editorEnabled ? ['--patch', editorPatch] : []),
    ], {
      cwd: repoRoot,
      env: {
        DSH_HOME: join(root, '.dsh'),
        DSH_PERMISSION_MODE: 'danger-full-access',
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: 'keyless-smoke-no-call',
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
        ...(envValue === undefined ? {} : { DSH_MAX_TOKENS_AS_SUCCESS: envValue }),
      },
      timeout: 35_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    const lines: string[] = []
    let stdoutBuffer = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      const parts = stdoutBuffer.split('\n')
      stdoutBuffer = parts.pop() ?? ''
      lines.push(...parts)
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          cwd: root,
          provider: 'deepseek-official',
          model: 'deepseek-v4-pro',
          reasoningEffort: 'max',
          maxTokens: 1234,
        },
      })}\n`)
      const initialized = await waitForLine(lines, value => value.id === 1, { waitingFor: 'the initialize response', stderr: () => stderr })
      expect(initialized).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' } },
      })

      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        params: { sessionId: 'main', contentBlocks: [{ type: 'text', text: 'inspect tools' }] },
      })}\n`)
      const prompt = await waitForLine(lines, value => value.id === 2, { waitingFor: 'the session/prompt response', stderr: () => stderr })
      expect(prompt).toMatchObject({
        jsonrpc: '2.0',
        id: 2,
        result: { messageId: expect.any(String) as unknown },
      })
      const turnEnd = await waitForLine(lines, (value) => {
        if (value.method !== 'session.event') return false
        const params = value.params as Record<string, unknown> | undefined
        const event = params?.event as Record<string, unknown> | undefined
        return params?.sessionId === 'main' && event?.type === 'turn/end'
      }, { waitingFor: "the session's turn/end event", stderr: () => stderr })
      expect(turnEnd).toMatchObject({
        jsonrpc: '2.0',
        method: 'session.event',
        params: {
          sessionId: 'main',
          event: {
            type: 'turn/end',
            data: { reason: { kind: 'max-tokens' } },
          },
        },
      })
      expect(modelRequests[0]?.tools).toEqual(expect.any(Array))
      const tools = modelRequests[0]?.tools as { function?: { name?: string } }[]
      const toolNames = tools.map(tool => tool.function?.name)
      expect(modelRequests[0]?.reasoning_effort).toBe('max')
      expect(modelRequests[0]?.max_tokens).toBe(1234)
      expect(toolNames).toEqual(expect.arrayContaining(['read', 'write', 'edit', 'web_fetch', 'web_search']))
      expect(toolNames.includes('str_replace_editor')).toBe(editorEnabled)
      expect(toolNames).not.toContain('list_subagent_models')

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'shutdown' })}\n`)
      const shutdown = await waitForLine(lines, value => value.id === 3, { waitingFor: 'the shutdown response', stderr: () => stderr })
      expect(shutdown).toMatchObject({ jsonrpc: '2.0', id: 3, result: {} })
      const exit = await child
      expect(exit.exitCode, `signal=${String(exit.signal)}; stderr=${stderr}`).toBe(0)
      const sessionsRoot = join(root, '.dsh', 'sessions')
      const files = await readdir(sessionsRoot, { recursive: true })
      const log = files.find(file => file.endsWith('.jsonl.zstd'))
      expect(log).toBeDefined()
      const compressed = await readFile(join(sessionsRoot, log!))
      expect(compressed.subarray(0, 4).toString('hex')).toBe('28b52ffd')
      expect(JSON.parse((await decompress(compressed)).toString())).toMatchObject({ type: 'session', id: 'main' })
    } finally {
      // No-op after exit; reject: false settles on every outcome, so cleanup never races teardown.
      child.kill('SIGKILL')
      await child
      await new Promise<void>(resolve => modelServer.close(() => { resolve() }))
      await rm(root, { recursive: true, force: true })
    }
  }, 40_000)

  it.each([
    { label: 'boots the standalone minimal profile through its generated manifest', editorEnabled: false },
    { label: 'executes the documented editor opt-in patch with sdk-minimal', editorEnabled: true },
  ])('$label', async ({ editorEnabled }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-python-sdk-minimal-'))
    const editorPatch = join(root, 'editor.patch.yml')
    if (editorEnabled) {
      const guide = await readFile(join(repoRoot, 'docs/user/guide/python-sdk.md'), 'utf8')
      const yaml = guide.split('<a id="opt-in-to-str_replace_editor"></a>')[1]
        ?.match(/```yaml\n([\s\S]*?)```/)?.[1]
      expect(yaml).toBeDefined()
      await writeFile(editorPatch, yaml!)
    }
    const editorFile = join(root, 'editor.txt')
    const editorContent = 'sdk-minimal editor opt-in\n'
    const editorCalls = editorEnabled ? [
      { command: 'create', path: editorFile, file_text: editorContent },
      { command: 'view', path: editorFile },
    ] : []
    const modelRequests: Record<string, unknown>[] = []
    const modelServer = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        modelRequests.push(JSON.parse(body) as Record<string, unknown>)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n')
        const toolCall = editorCalls[modelRequests.length - 1]
        if (toolCall) {
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
            index: 0,
            id: `editor-${toolCall.command}`,
            type: 'function',
            function: { name: 'str_replace_editor', arguments: JSON.stringify(toolCall) },
          }] } }] })}\n\n`)
        } else {
          response.write('data: {"choices":[{"delta":{"content":"done"}}]}\n\n')
        }
        response.write(`data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        })}\n\n`)
        response.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve))
    const address = modelServer.address()
    if (address === null || typeof address === 'string') throw new Error('model server did not bind a TCP port')
    const child = execa(process.execPath, [
      '--import',
      'tsx/esm',
      binScript,
      '--profile',
      'sdk-minimal',
      ...(editorEnabled ? ['--patch', editorPatch] : []),
    ], {
      cwd: repoRoot,
      env: {
        DSH_HOME: join(root, '.dsh'),
        DSH_SYSTEM_PROMPT: 'Minimal allowlist prompt.',
        DEEPSEEK_API_KEY: 'keyless-smoke-no-call',
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
      },
      timeout: 35_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    const lines: string[] = []
    let stdoutBuffer = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      const parts = stdoutBuffer.split('\n')
      stdoutBuffer = parts.pop() ?? ''
      lines.push(...parts)
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { cwd: root, provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      })}\n`)
      await waitForLine(lines, value => value.id === 1, { waitingFor: 'the initialize response', stderr: () => stderr })
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        params: { sessionId: 'minimal', contentBlocks: [{ type: 'text', text: 'inspect tools' }] },
      })}\n`)
      const turnEnd = await waitForLine(lines, (value) => {
        const params = value.params as Record<string, unknown> | undefined
        const event = params?.event as Record<string, unknown> | undefined
        return params?.sessionId === 'minimal' && event?.type === 'turn/end'
      }, { waitingFor: "the session's turn/end event", stderr: () => stderr })
      expect(turnEnd).toMatchObject({
        params: { event: { data: { reason: { kind: 'completed' } } } },
      })

      const profile = JSON.parse(
        await readFile(join(root, '.dsh', 'profiles', 'sdk-minimal', 'package.json'), 'utf8'),
      ) as { dsh?: { profile?: { bundles?: string[]; patchReload?: string } } }
      expect(profile.dsh?.profile).toEqual({
        bundles: ['@deepseek-ai/dsh-sdk-minimal'],
        patchReload: 'startup',
      })
      expect(modelRequests[0]?.tools).toEqual(expect.any(Array))
      const tools = modelRequests[0]?.tools as { function?: { name?: string } }[]
      expect(tools.map(tool => tool.function?.name)).toEqual([
        process.platform === 'win32' ? 'pwsh' : 'bash',
        ...(editorEnabled ? ['str_replace_editor'] : []),
      ])
      expect(modelRequests).toHaveLength(editorEnabled ? 3 : 1)
      if (editorEnabled) {
        expect(await readFile(editorFile, 'utf8')).toBe(editorContent)
        expect(modelRequests[2]?.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            role: 'tool',
            tool_call_id: 'editor-view',
            content: expect.stringContaining(editorContent.trim()) as unknown,
          }),
        ]))
      }

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'shutdown' })}\n`)
      await waitForLine(lines, value => value.id === 3, { waitingFor: 'the shutdown response', stderr: () => stderr })
      const exit = await child
      expect(exit.timedOut, stderr).toBe(false)
      expect(exit.signal, stderr).toBeUndefined()
      expect(exit.exitCode, `signal=${String(exit.signal)}; stderr=${stderr}`).toBe(0)
    } finally {
      child.kill('SIGKILL')
      await child
      await new Promise<void>(resolve => modelServer.close(() => { resolve() }))
      await rm(root, { recursive: true, force: true })
    }
  }, 40_000)

  it('rejects an invalid max-token success env value', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-python-sdk-runtime-invalid-'))
    try {
      const { exitCode, stdout, stderr } = await execa(process.execPath, [
        '--import',
        'tsx/esm',
        binScript,
        '--profile',
        'sdk',
      ], {
        cwd: repoRoot,
        env: {
          DSH_HOME: join(root, '.dsh'),
          DEEPSEEK_API_KEY: 'keyless-smoke-no-call',
          DSH_MAX_TOKENS_AS_SUCCESS: 'sometimes',
        },
        stdin: 'ignore',
        timeout: 25_000,
        killSignal: 'SIGKILL',
        reject: false,
      })

      expect(exitCode, stderr).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toContain('plugin tree failed to load')
      expect(stderr).toContain('failed to apply loader entry sdk-jsonrpc-server (@deepseek-ai/dsh-sdk-jsonrpc-server)')
      expect(stderr).toContain('sometimes')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  /*
   * P2-01 acceptance[0] on the SDK face. A session this server composes per
   * request (`server.ts:510`) now acts as the machine's host user, so the
   * three things this case reads from the durable log are the three the
   * clause asks for: the FIRST `action/manifest-appended` names a principal
   * that is not the anonymous dev fallback
   * (`action-manifest/src/identity.ts:52`), that principal is the one the
   * launcher persisted under this `$DSH_HOME`, and exactly one
   * `identity/attached` is logged.
   *
   * The commit before this one asserted the opposite values -- the anonymous
   * principal and zero attachments -- and was observed green in run
   * 35479346884 (8 passed, this case in 2235ms), the first run in which that
   * control passed at all: before `afac505e1b` it waited out its deadline on a
   * turn the server had refused and failed four times running. So what these
   * conditions replaced is on record as an observation rather than as an
   * assumption.
   */
  it('P2-01 acceptance[0]: a launched sdk session acts as the host user, attached once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-sdk-host-user-'))
    const dshHome = join(root, '.dsh')
    const stub = await startStubModelServer({
      // Per request, not per turn: call the tool, then close the turn.
      toolCalls: [
        { name: 'write', arguments: { file_path: join(root, 'first.txt'), content: 'P2-01\n' } },
        undefined,
      ],
    })
    try {
      const firstLaunchRequests = await runSdkTurn(dshHome, stub)
      const { compressed, records } = await readSessionLog(join(dshHome, 'sessions'))

      // The log is a concatenated-frame container, so reading it whole is not
      // the same as reading its first frame. Asserted because the rest of this
      // case depends on seeing events, and a one-shot read sees only the header.
      expect(records[0]?.type).toBe('session')
      expect(records.length).toBeGreaterThan(1)
      expect(scanZstdFrames(compressed).frames.length).toBeGreaterThan(1)
      expect(JSON.parse((await decompress(compressed)).toString())).toEqual(records[0])

      // The first manifest, not any of them: acceptance[0] is about what the
      // session was attributed to from its first action onward.
      const manifests = records.filter(record => record.type === 'action/manifest-appended')
      expect(manifests.length).toBeGreaterThan(0)
      expect(manifests[0]?.data?.actor).not.toMatch(/^anonymous:/)
      expect(manifests[0]?.data?.actor).toBe(attachedPrincipal({ compressed, records }))
      expect(countRecords({ compressed, records }, 'identity/attached')).toBe(1)

      // And that principal is THE host user, not merely some non-anonymous
      // one: the launcher persisted this id under its own home, and
      // `hostUserIdentity` brands that exact string as the principal id.
      expect(attachedPrincipal({ compressed, records })).toBe(await persistedHostUserId(dshHome))

      // The resume half of acceptance[0] -- that a SECOND launch against the
      // same `$DSH_HOME` adds no second attachment -- is not driven here.
      // This surface has no way to ask for it: the SDK's request map is
      // `initialize`, `session/prompt` and `shutdown`
      // (`sdk/protocol/src/types.ts:405-410`), none of which names a
      // persisted session, and `session/prompt` always creates
      // (`sdk/server/src/server.ts:490-522`), which the durable backend
      // refuses once a log for that id is on disk
      // (`session-persistence-jsonl/src/index.ts:317-318`, throwing the
      // `SessionAlreadyExistsError` of `session-persistence/src/errors.ts:21-28`).
      // The live-store refusal at `core/session/src/index.ts:1002` prints the
      // SAME sentence and is a different gate: that store is a per-process
      // Map, empty in a fresh launch. BLOCKED-298 holds the gap; the
      // two-launch evidence for acceptance[0] is the ACP case's.

      // Named, not swallowed. Nothing on this surface should ask the client
      // anything: `bundle/base/cordis.patch.yml:270-273` sets the approval
      // policy to `never` under `danger-full-access`, which this launch uses.
      // If a request arrives anyway the driver answers it so the run can
      // finish, and this says WHICH -- instead of the case dying of a timeout
      // that names nothing, which is what it did on run 35467913630.
      expect(firstLaunchRequests).toEqual([])
    } finally {
      await stub.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
