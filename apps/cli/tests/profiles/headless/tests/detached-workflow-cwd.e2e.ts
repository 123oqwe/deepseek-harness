/**
 * BLOCKED-324: on a `dsh --profile headless` launch, an agent that a detached
 * workflow run starts completes its turn, and the run's session and that
 * agent's session carry the launcher's working directory.
 *
 * The launch is the shipped headless template with no `--patch`
 * (`apps/cli/src/bin.ts --profile headless <task>` through `runLoaderSmoke`).
 * The headless bundle sets `personaSuffix: Your working directory is {{cwd}}.`
 * (`packages/bundle/headless/cordis.patch.yml:9`), and `{{cwd}}` reads the
 * session header's `cwd` (`packages/core/agent-loop/src/index.ts:488`). The
 * launcher's session is created with the process cwd
 * (`packages/bundle/headless/src/index.ts:319`).
 *
 * The launcher's agent calls `workflow` with `detached: true`. `startDetached`
 * creates the run's own agent on its own session
 * (`packages/workflow/workflow-worker-thread/src/index.ts`), and the script's
 * one `agent(...)` call delegates from that agent to a child whose header takes
 * the run's `cwd` (`childSessionMeta`, `packages/subagent/subagent/src/child-agent.ts`).
 * The child makes one `bash` call and answers. The launcher then collects the
 * run with `workflow` `attach`, so the run has settled before the launch exits.
 *
 * The stand-in model answers from each request's content
 * (`../../routing-stub-model.ts`): the child's first step after its prompt
 * with the `bash` call, the launcher's first step after the task with the
 * detached `workflow` call, its step after that call's result with `workflow`
 * `attach` for the run id the result names, and every other request with
 * text, the session-title request among them.
 *
 * @module apps/cli/tests/profiles/headless/tests/detached-workflow-cwd
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
const TASK = 'BLOCKED-324-LAUNCHER: start the detached workflow run, then collect it.'

/** Text only the delegated child's prompt contains; it is in the launcher's history only inside the script argument. */
const CHILD_PROMPT = 'BLOCKED-324-WORKFLOW-CHILD: print the proof string with bash, then stop.'

/** The run id in the result of a detached `workflow` start (`packages/workflow/tool-workflow/src/index.ts:286`). */
const DETACHED_RUN_ID = /started detached as ([0-9a-f-]{36})/

/**
 * Answer one request from what it carries.
 * @param request - the request body.
 * @returns the tool call this step makes, or `undefined` to answer with text.
 */
function answer(request: StubRequest): StubToolCall | undefined {
  if (isFirstStepAfterPrompt(request, CHILD_PROMPT)) {
    return { name: 'bash', arguments: { command: 'printf BLOCKED-324-CHILD', description: 'Print the proof string' } }
  }
  if (isFirstStepAfterPrompt(request, TASK)) {
    return {
      name: 'workflow',
      arguments: {
        detached: true,
        meta: { name: 'blocked-324-detached-cwd', description: 'One delegated child runs one tool call inside a detached run.' },
        script: `return await agent(${JSON.stringify(CHILD_PROMPT)})`,
      },
    }
  }
  const runId = DETACHED_RUN_ID.exec(lastToolResult(request) ?? '')?.[1]
  return runId === undefined ? undefined : { name: 'workflow', arguments: { attach: runId } }
}

/** The members of a session log's header record this case reads. */
interface LoggedHeader {
  readonly id?: unknown
  readonly parentSession?: unknown
  readonly origin?: unknown
  readonly cwd?: unknown
}

/**
 * The header record that opens a session log.
 * @param log - a log read by `readSessionLogs`.
 * @returns its first record's header members.
 */
function headerOf(log: SessionLog): LoggedHeader {
  return (log.records[0] ?? {}) as LoggedHeader
}

/**
 * The payload member `key` of every record of one type, in log order.
 * @param log - a log read by `readSessionLogs`.
 * @param type - the record type.
 * @param key - the payload member to read.
 * @returns one value per matching record.
 */
function payloads(log: SessionLog, type: string, key: string): unknown[] {
  return log.records.filter(record => record.type === type).map(record => record.data?.[key])
}

describe('a detached workflow run on dsh --profile headless (no key required)', () => {
  it('BLOCKED-324: the run\'s child completes its turn, and the run\'s and the child\'s sessions carry the launcher\'s cwd', async () => {
    const stub = await startRoutingStubModelServer(answer)
    const observed: { logs?: readonly SessionLog[] } = {}
    try {
      await runLoaderSmoke({
        label: 'blocked-324-detached-workflow-cwd',
        tempDirPrefix: 'dsh-blocked-324-',
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

    // The launcher is the root session; the run's session names it as its
    // parent without being a subagent's; the child is the subagent the run's
    // agent delegated to.
    const launcher = logs.find(log => headerOf(log).parentSession === undefined)
    const launcherId = launcher === undefined ? undefined : headerOf(launcher).id
    const run = logs.find(log => headerOf(log).parentSession === launcherId && headerOf(log).origin !== 'subagent')
    const runId = run === undefined ? undefined : headerOf(run).id
    const child = logs.find(log => headerOf(log).parentSession === runId && headerOf(log).origin === 'subagent')
    if (launcher === undefined || run === undefined || child === undefined) {
      const headers = JSON.stringify(logs.map(headerOf))
      throw new Error(`expected a launcher, a detached run and its child among the persisted sessions: ${headers}`)
    }

    // The child's one turn completed: its system prompt assembled, it made its
    // one tool call and answered.
    const childEnds = payloads(child, 'turn/end', 'reason')
    expect(childEnds, `the child's turn/end reasons: ${JSON.stringify(childEnds)}`).toEqual([{ kind: 'completed' }])
    expect(payloads(child, 'tool/call', 'name')).toEqual(['bash'])

    // The run's session and the child's carry the launcher's working directory.
    const launcherCwd = headerOf(launcher).cwd
    expect(launcherCwd).toEqual(expect.any(String))
    expect(headerOf(run).cwd).toBe(launcherCwd)
    expect(headerOf(child).cwd).toBe(launcherCwd)
  }, PROCESS_TIMEOUT_MS + 15_000)
})
