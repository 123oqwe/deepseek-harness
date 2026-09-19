import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { zstdDecompress, zstdDecompressSync } from 'node:zlib'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { startStubModelServer } from '@deepseek-ai/dsh-session-snapshot'
import { scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.js'

const binScript = fileURLToPath(new URL('../../../src/bin.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const decompress = promisify(zstdDecompress)

/** One record of a durable session log, as the log's own JSONL lines carry it. */
interface SessionLogRecord {
  type: string
  data?: Record<string, unknown>
}

/**
 * Read one session's whole durable log out of a harness home.
 *
 * Every frame, not just the first: the JSONL backend appends a Zstandard frame
 * per batch, so a one-shot decompress of the file yields the first frame alone.
 * @param dshHome - the `$DSH_HOME` the child ran under.
 * @returns the log's bytes and its records in file order.
 */
async function readSessionLog(dshHome: string): Promise<{ compressed: Buffer; records: SessionLogRecord[] }> {
  const sessionsRoot = join(dshHome, 'sessions')
  const files = await readdir(sessionsRoot, { recursive: true })
  const log = files.find(file => file.endsWith('.jsonl.zstd'))
  expect(log).toBeDefined()
  const compressed = await readFile(join(sessionsRoot, log!))
  const { frames, tornStart } = scanZstdFrames(compressed)
  expect(tornStart).toBeUndefined()
  const records = frames
    .flatMap(({ start, end }) => zstdDecompressSync(compressed.subarray(start, end)).toString().trim().split('\n'))
    .map(line => JSON.parse(line) as SessionLogRecord)
  return { compressed, records }
}

function waitForLine(
  lines: string[],
  predicate: (value: Record<string, unknown>) => boolean,
  stderr: () => string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000
    const poll = (): void => {
      while (lines.length > 0) {
        const line = lines.shift()!
        if (!line.trim()) continue
        try {
          const value = JSON.parse(line) as Record<string, unknown>
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
        reject(new Error(`timed out waiting for JSON-RPC response; stderr=${stderr()}`))
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
 * attaches: calling this twice against one `$DSH_HOME` and one session id is
 * how the resume half is driven, the JSON-RPC surface having no resume method
 * of its own (`packages/sdk/server/src/server.ts:477-487`).
 * @param dshHome - harness home; the second call reuses the first one's.
 * @param baseUrl - the stand-in model endpoint.
 * @returns nothing; it throws on any non-clean exit.
 */
async function runSdkTurn(dshHome: string, baseUrl: string): Promise<void> {
  const child = execa(process.execPath, ['--import', 'tsx/esm', binScript, '--profile', 'sdk'], {
    cwd: repoRoot,
    env: {
      DSH_HOME: dshHome,
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: 'keyless-smoke-no-call',
      DEEPSEEK_BASE_URL: baseUrl,
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
      params: { cwd: dshHome, provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    })}\n`)
    await waitForLine(lines, value => value.id === 1, () => stderr)
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId: 'main', contentBlocks: [{ type: 'text', text: 'write the proof file' }] },
    })}\n`)
    await waitForLine(lines, value => value.id === 2, () => stderr)
    await waitForLine(lines, (value) => {
      if (value.method !== 'session.event') return false
      const params = value.params as Record<string, unknown> | undefined
      const event = params?.event as Record<string, unknown> | undefined
      return params?.sessionId === 'main' && event?.type === 'turn/end'
    }, () => stderr)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'shutdown' })}\n`)
    await waitForLine(lines, value => value.id === 3, () => stderr)
    const exit = await child
    expect(exit.exitCode, `signal=${String(exit.signal)}; stderr=${stderr}`).toBe(0)
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
      const initialized = await waitForLine(lines, value => value.id === 1, () => stderr)
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
      const prompt = await waitForLine(lines, value => value.id === 2, () => stderr)
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
      }, () => stderr)
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
      const shutdown = await waitForLine(lines, value => value.id === 3, () => stderr)
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
      await waitForLine(lines, value => value.id === 1, () => stderr)
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
      }, () => stderr)
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
      await waitForLine(lines, value => value.id === 3, () => stderr)
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
   * BLOCKED-291 negative control. It pins TODAY'S DEFECT, not the fix: the SDK
   * server creates an agent per request (`server.ts:510`) without an identity,
   * so nothing is attached and every manifest is attributed to the anonymous
   * dev principal (`action-manifest/src/identity.ts:52`). The assertions below
   * state those values positively, so this case passes only while the defect is
   * there and fails the moment it is fixed — which is what makes the fix's own
   * commit, which flips them to P2-01 acceptance[0]'s form, an observation
   * rather than a claim. It is deliberately not written as an expected failure:
   * an expected failure passes for any reason at all, including a broken
   * environment.
   */
  it('BLOCKED-291 negative control: a launched sdk session attaches no identity and acts as anonymous', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-sdk-host-user-'))
    const dshHome = join(root, '.dsh')
    const stub = await startStubModelServer({
      // Per request: call, close the turn, then call again on the second
      // launch. The second call is what proves the resumed launch really
      // composed an Agent -- only a running Agent appends a manifest.
      toolCalls: [
        { name: 'write', arguments: { file_path: join(root, 'first.txt'), content: 'P2-01\n' } },
        undefined,
        { name: 'write', arguments: { file_path: join(root, 'second.txt'), content: 'P2-01\n' } },
      ],
    })
    try {
      await runSdkTurn(dshHome, stub.baseUrl)
      const { compressed, records } = await readSessionLog(dshHome)

      // The log is a concatenated-frame container, so reading it whole is not
      // the same as reading its first frame. Asserted because the rest of this
      // case depends on seeing events, and a one-shot read sees only the header.
      expect(records[0]?.type).toBe('session')
      expect(records.length).toBeGreaterThan(1)
      expect(scanZstdFrames(compressed).frames.length).toBeGreaterThan(1)
      expect(JSON.parse((await decompress(compressed)).toString())).toEqual(records[0])

      const manifests = records.filter(record => record.type === 'action/manifest-appended')
      expect(manifests.length).toBeGreaterThan(0)
      expect(manifests[0]?.data?.actor).toMatch(/^anonymous:/)
      expect(records.filter(record => record.type === 'identity/attached')).toHaveLength(0)

      // The resume half. One `$DSH_HOME` and one session id across two
      // launches: the `identity/attached` count must go 0 -> 0 here, and
      // 1 -> 1 once the fix lands. Asserting "no second record" alone would
      // hold vacuously today AND after the fix if the second launch never
      // composed an Agent, so the growing manifest count is asserted first:
      // only a composed, running Agent appends one.
      await runSdkTurn(dshHome, stub.baseUrl)
      const resumed = await readSessionLog(dshHome)
      const resumedManifests = resumed.records.filter(record => record.type === 'action/manifest-appended')
      expect(resumedManifests.length).toBeGreaterThan(manifests.length)
      expect(resumedManifests.at(-1)?.data?.actor).toMatch(/^anonymous:/)
      expect(resumed.records.filter(record => record.type === 'identity/attached')).toHaveLength(0)
    } finally {
      await stub.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
