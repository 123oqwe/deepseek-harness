/**
 * P2-01 acceptance[0] inside a detached workflow run: an action taken inside
 * the run is traceable through a delegation chain that records the run itself
 * as a hop, on a real `dsh --profile headless` launch with no `--patch`.
 *
 * The composition is the shipped headless template: dsh-base mounts the
 * worker-thread workflow engine and the `workflow` tool
 * (`packages/bundle/base/cordis.patch.yml:641-647`). The launcher's agent calls
 * `workflow` with `detached: true`; the engine gives the run its own agent on
 * its own session (`packages/workflow/workflow-worker-thread/src/index.ts:383-455`),
 * and the script's one `agent(...)` call delegates from that agent to a child
 * (`packages/workflow/workflow-worker-thread/src/host.ts:505-521`), which
 * makes one `bash` call: the action this case reads. The launcher then collects
 * the run with `workflow` `attach`, so its turn ends only after the run has
 * settled. The settled run's worker thread outlives the tree's disposal, so the
 * launch preloads `../../../fixtures/exit-when-recorded.mjs`, which exits the
 * process once `dsh` has recorded its exit code.
 *
 * What the case expects of the run's agent is the hop `delegateChildIdentity`
 * writes for a delegated child (`packages/subagent/subagent/src/child-agent.ts:142-156`):
 * an `agent` principal named `agent:<the run's session id>`, in the
 * launcher's tenant, delegated by the launcher's acting principal. Today the
 * run's agent is created with `parentAgentOptionsForDelegation`
 * (`packages/workflow/workflow-worker-thread/src/index.ts:420`), which carries
 * the launcher's identity over unchanged, so this case fails until that hop is
 * added.
 *
 * The stand-in model answers from each request's content
 * (`../../routing-stub-model.ts`): the launcher's first step after the task
 * with the detached `workflow` call, its step after that call's result with
 * `workflow` `attach` for the run id the result names, the child's first step
 * after its prompt with one `bash` call, and every other request with text,
 * the session-title request among them.
 *
 * @module apps/cli/tests/profiles/headless/tests/workflow-chain
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
import { attachedIdentity, readSessionLogs, type SessionLog } from '../../session-log.ts'

const BIN_SCRIPT = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const TSCONFIG = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))
const EXIT_WHEN_RECORDED = new URL('../../../fixtures/exit-when-recorded.mjs', import.meta.url).href

/** Text only the launcher's task contains. */
const TASK = 'P2-01-DETACHED-LAUNCHER: start the detached workflow run, then collect it.'

/** Text only the delegated child's prompt contains; it is in the launcher's history only inside the script argument. */
const CHILD_PROMPT = 'P2-01-WORKFLOW-CHILD: print the proof string with bash, then stop.'

/** The detached run's script: one delegated child, whose final text is the run's value. */
const SCRIPT = `return await agent(${JSON.stringify(CHILD_PROMPT)})`

/** The run id in the result of a detached `workflow` start (`packages/workflow/tool-workflow/src/index.ts:286`). */
const DETACHED_RUN_ID = /started detached as ([0-9a-f-]{36})/

/**
 * Answer one request from what it carries.
 * @param request - the request body.
 * @returns the tool call this step makes, or `undefined` to answer with text.
 */
function answer(request: StubRequest): StubToolCall | undefined {
  if (isFirstStepAfterPrompt(request, CHILD_PROMPT)) {
    return { name: 'bash', arguments: { command: 'printf P2-01-WORKFLOW-CHILD', description: 'Print the proof string' } }
  }
  if (isFirstStepAfterPrompt(request, TASK)) {
    return {
      name: 'workflow',
      arguments: {
        detached: true,
        meta: { name: 'p2-01-detached-chain', description: 'One delegated child acts inside a detached run.' },
        script: SCRIPT,
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
}

/**
 * The header record that opens a session log.
 * @param log - a log read by `readSessionLogs`.
 * @returns its first record's header members.
 */
function headerOf(log: SessionLog): LoggedHeader {
  return (log.records[0] ?? {}) as LoggedHeader
}

/** A record type whose payload says how a tool call, a turn or a workflow run ended. */
const OUTCOME_TYPE = /^(?:tool\/result|turn\/end|workflow\/)/

/**
 * What each persisted session did, for the failure message of a precondition:
 * its header, how many records of each type it logged, and the payload of
 * every outcome record, each cut to 400 characters.
 * @param logs - the persisted sessions.
 * @returns one JSON line per session.
 */
function diagnosis(logs: readonly SessionLog[]): string {
  return logs.map((log) => {
    const types: Record<string, number> = {}
    for (const record of log.records) types[record.type] = (types[record.type] ?? 0) + 1
    const outcomes = log.records
      .filter(record => OUTCOME_TYPE.test(record.type))
      .map(record => `${record.type} ${JSON.stringify(record.data ?? null).slice(0, 400)}`)
    return JSON.stringify({ header: headerOf(log), types, outcomes })
  }).join('\n')
}

/** The three sessions the launch persisted, read before its home is removed. */
interface DetachedRunObservation {
  /** Every session log under the launch's harness home. */
  readonly logs: readonly SessionLog[]
}

describe('a detached workflow run on dsh --profile headless (no key required)', () => {
  it('P2-01 acceptance[0]: an action inside a detached workflow run carries its launcher\'s delegation chain plus the workflow hop', async () => {
    const stub = await startRoutingStubModelServer(answer)
    const observed: { value?: DetachedRunObservation } = {}
    try {
      await runLoaderSmoke({
        label: 'p2-01-detached-workflow-chain',
        tempDirPrefix: 'dsh-p2-01-workflow-chain-',
        binScript: BIN_SCRIPT,
        configPath: '',
        binArgs: ['--profile', 'headless', TASK],
        tsconfigPath: TSCONFIG,
        processTimeoutMs: 90_000,
        env: {
          DEEPSEEK_API_KEY: 'sk-dummy-for-boot',
          DEEPSEEK_BASE_URL: stub.baseUrl,
          DSH_PERMISSION_MODE: 'danger-full-access',
          DSH_TELEMETRY_DISABLED: '1',
          // Empty, not absent: the launch pins its Trust Kernel, so the run
          // derives its capability token as a shipped launch does.
          DSH_TRUST_KERNEL_INSECURE: '',
          NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${EXIT_WHEN_RECORDED}`].filter(Boolean).join(' '),
        },
        inspect: async (cwd) => {
          observed.value = { logs: await readSessionLogs(join(cwd, '.dsh', 'sessions')) }
        },
      })
    } finally {
      await stub.close()
    }
    const { value } = observed
    if (value === undefined) throw new Error('the launch exited 0 and inspect recorded nothing')
    const { logs } = value

    // The launcher is the root session; the run's session names it as its
    // parent without being a subagent's; the child is the subagent the run's
    // agent delegated to (`childSessionMeta`, child-agent.ts:213-231).
    const launcher = logs.find(log => headerOf(log).parentSession === undefined)
    const launcherId = launcher === undefined ? undefined : headerOf(launcher).id
    const run = logs.find(log => headerOf(log).parentSession === launcherId && headerOf(log).origin !== 'subagent')
    const runId = run === undefined ? undefined : headerOf(run).id
    const child = logs.find(log => headerOf(log).parentSession === runId && headerOf(log).origin === 'subagent')
    const sessions = logs.map(log => headerOf(log))
    if (launcher === undefined || run === undefined || child === undefined) {
      throw new Error(`expected a launcher, a detached run and its child among the persisted sessions: ${JSON.stringify(sessions)}`)
    }
    const childId = headerOf(child).id

    const launcherChain = attachedIdentity(launcher).chain?.entries ?? []
    const runChain = attachedIdentity(run).chain?.entries ?? []
    const actionChain = attachedIdentity(child).chain?.entries ?? []
    const launcherActing = launcherChain.at(-1)?.principal

    // The action inside the run, attributed to the principal its chain ends in.
    const actions = child.records.filter(record => record.type === 'action/manifest-appended')
    expect(actions.length, `the run's child logged no action; each persisted session:\n${diagnosis(logs)}`).toBeGreaterThan(0)
    expect(actions[0]?.data?.actor).toBe(actionChain.at(-1)?.principal?.id)

    // The run's agent acts under its launcher's chain plus one hop: the
    // workflow hop, an agent principal named after the run's own session.
    expect(runChain.map(entry => entry.principal)).toEqual([
      ...launcherChain.map(entry => entry.principal),
      { kind: 'agent', id: `agent:${String(runId)}`, tenantId: launcherActing?.tenantId, delegatedBy: launcherActing?.id },
    ])

    // So the action's chain runs from the launcher's root through the
    // workflow hop to the child that acted.
    expect(actionChain.map(entry => entry.principal?.id)).toEqual([
      ...launcherChain.map(entry => entry.principal?.id),
      `agent:${String(runId)}`,
      `agent:${String(childId)}`,
    ])
  }, 120_000)
})
