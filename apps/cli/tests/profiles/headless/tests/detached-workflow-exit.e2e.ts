/**
 * BLOCKED-323: a `dsh --profile headless` launch that starts a detached
 * workflow run and collects it exits on its own after printing its result.
 *
 * The launch is the shipped headless template with no `--patch`:
 * `apps/cli/src/bin.ts --profile headless <task>` through `runLoaderSmoke`,
 * which fails the case with "did not exit within" when the process is still
 * running at `PROCESS_TIMEOUT_MS` and kills it only then. The case adds no
 * preload and sends no signal, so the process has to end by itself.
 *
 * dsh-base mounts the worker-thread workflow engine and the `workflow` tool
 * (`packages/bundle/base/cordis.patch.yml:641-647`). The launcher's agent calls
 * `workflow` with `detached: true`, and the run executes its script on its own
 * worker thread, which `WorkerRun.dispose` terminates
 * (`packages/workflow/workflow-worker-thread/src/host.ts`). The script starts
 * no agent, so the run has no child session. The launcher then collects the
 * run with `workflow` `attach`, so the run has settled before the turn ends.
 *
 * The stand-in model answers from each request's content
 * (`../../routing-stub-model.ts`): the launcher's first step after the task
 * with the detached `workflow` call, its step after that call's result with
 * `workflow` `attach` for the run id the result names, and every other request
 * with text, the session-title request among them.
 *
 * @module apps/cli/tests/profiles/headless/tests/detached-workflow-exit
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { StubToolCall } from '@deepseek-ai/dsh-session-snapshot'
import {
  isFirstStepAfterPrompt,
  lastToolResult,
  startRoutingStubModelServer,
  type StubRequest,
} from '../../routing-stub-model.ts'
import { readSessionLogs, type SessionLog } from '../../session-log.ts'

const BIN_SCRIPT = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const TSCONFIG = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))

/** How long the launch may run before the case fails it as not having exited. */
const PROCESS_TIMEOUT_MS = 60_000

/** Text only the launcher's task contains. */
const TASK = 'BLOCKED-323-LAUNCHER: start the detached workflow run, then collect it.'

/** The value the detached run's script returns. */
const RUN_VALUE = 'BLOCKED-323-RUN-VALUE'

/** The run id in the result of a detached `workflow` start (`packages/workflow/tool-workflow/src/index.ts:286`). */
const DETACHED_RUN_ID = /started detached as ([0-9a-f-]{36})/

/**
 * Answer one request from what it carries.
 * @param request - the request body.
 * @returns the tool call this step makes, or `undefined` to answer with text.
 */
function answer(request: StubRequest): StubToolCall | undefined {
  if (isFirstStepAfterPrompt(request, TASK)) {
    return {
      name: 'workflow',
      arguments: {
        detached: true,
        meta: { name: 'blocked-323-detached-exit', description: 'A detached run that starts no agent.' },
        script: `return ${JSON.stringify(RUN_VALUE)}`,
      },
    }
  }
  const runId = DETACHED_RUN_ID.exec(lastToolResult(request) ?? '')?.[1]
  return runId === undefined ? undefined : { name: 'workflow', arguments: { attach: runId } }
}

/**
 * Whether a session log's header names no parent session, which only the launcher's does.
 * @param log - a log read by `readSessionLogs`.
 * @returns true for the launcher's log.
 */
function isRootSession(log: SessionLog): boolean {
  return (log.records[0] as { parentSession?: unknown } | undefined)?.parentSession === undefined
}

/**
 * The tool-result messages a session logged, each as JSON text, in log order.
 * @param log - a log read by `readSessionLogs`.
 * @returns one string per `tool/result` record.
 */
function toolResults(log: SessionLog): string[] {
  return log.records
    .filter(record => record.type === 'tool/result')
    .map(record => JSON.stringify(record.data?.['message'] ?? null))
}

describe('a detached workflow run on dsh --profile headless (no key required)', () => {
  it('BLOCKED-323: the launch exits on its own after the detached run it collected has settled', async () => {
    const stub = await startRoutingStubModelServer(answer)
    const observed: { logs?: readonly SessionLog[] } = {}
    try {
      await runLoaderSmoke({
        label: 'blocked-323-detached-workflow-exit',
        tempDirPrefix: 'dsh-blocked-323-',
        binScript: BIN_SCRIPT,
        configPath: '',
        binArgs: ['--profile', 'headless', TASK],
        tsconfigPath: TSCONFIG,
        processTimeoutMs: PROCESS_TIMEOUT_MS,
        env: {
          DEEPSEEK_API_KEY: 'sk-dummy-for-boot',
          DEEPSEEK_BASE_URL: stub.baseUrl,
          DSH_PERMISSION_MODE: 'danger-full-access',
          DSH_TELEMETRY_DISABLED: '1',
          // Empty, not absent: the launch pins its Trust Kernel, so the run
          // derives its capability token as a shipped launch does.
          DSH_TRUST_KERNEL_INSECURE: '',
        },
        inspect: async (cwd) => {
          observed.logs = await readSessionLogs(join(cwd, '.dsh', 'sessions'))
        },
      })
    } finally {
      await stub.close()
    }
    const { logs } = observed
    if (logs === undefined) throw new Error('the launch exited 0 and inspect recorded nothing')

    // The launcher's two tool results are the detached start and the collected
    // outcome, so the process exited after a run that started, ran its script
    // and settled.
    const launcher = logs.find(isRootSession)
    if (launcher === undefined) throw new Error(`no launcher session among ${String(logs.length)} persisted logs`)
    const results = toolResults(launcher)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatch(DETACHED_RUN_ID)
    expect(results[1]).toContain('completed (0 agents)')
    expect(results[1]).toContain(RUN_VALUE)
  }, PROCESS_TIMEOUT_MS + 15_000)
})
