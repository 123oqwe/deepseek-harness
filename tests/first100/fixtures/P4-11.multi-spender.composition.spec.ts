/**
 * Epic P4-11 acceptance[1] on the shipped profiles: 多个插件不能使总重试超过
 * Run budget.
 *
 * Three layers redo work for a run on a profile a user starts. `llm-retry`
 * and `compaction-basic`'s context-overflow recovery both resend a failed
 * model request, and both are `dsh-base` rows under `headless`. On `acp`,
 * `dsh-acp` mounts each session's MCP servers inside that session's Agent
 * scope, and their supervisor reconnects a dropped server. Each case runs
 * scripted turns in ONE session — a Run is 1:1 with a session — and reads the
 * run's usage beside the session's own log. No overlay touches
 * `run-retry-usage`, so the allowance under test is the shipped
 * `maxRetries: 10`.
 *
 * Failures are injected at the adapter boundary. The MCP server is
 * third-party input declared the way an ACP client declares one in
 * `session/new`; no shipped profile declares any, so nothing triggers that
 * path on a factory boot until a client does.
 */
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('../../../packages/reliability/retry-cockatiel/tests/fixtures/multi-spender-driver.ts', import.meta.url))
const headless = fileURLToPath(new URL('../../../packages/reliability/retry-cockatiel/tests/fixtures/multi-spender.patch.yml', import.meta.url))
const acp = fileURLToPath(new URL('../../../packages/reliability/retry-cockatiel/tests/fixtures/multi-spender-acp.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The driver's plan; see `multi-spender-driver.ts`. */
interface Plan {
  readonly profile: 'headless' | 'acp'
  readonly turns: readonly { readonly outcomes: readonly string[]; readonly padded?: boolean }[]
  readonly dropMcpAfterTurn?: number
  readonly probe?: boolean
}

interface TurnReading {
  turn: number
  requests: number
  retryStarted: number
  compactionStarted: number
  compactionCompleted: number
  end: string
}

interface Usage {
  run: string
  retriesUsed: number
  delayMsUsed: number
}

/** What the driver reported. */
interface Report {
  turns: TurnReading[]
  usage?: Usage
  usageBeforeDrop?: Usage
  usageAfterReconnect?: Usage
  mcp?: { pid: number; listed: boolean }[]
  probe?: { admitted: boolean; reason?: string }
}

/**
 * Boot one shipped profile, run the plan in one session, and return what the
 * driver read.
 * @param label - diagnostic name for this boot.
 * @param overlay - the test overlay for the plan's profile.
 * @param plan - the turns to script.
 * @returns the driver's report.
 */
async function run(label: string, overlay: string, plan: Plan): Promise<Report> {
  const { stdout } = await runLoaderSmoke({
    label,
    tempDirPrefix: 'p4-11-multi-',
    binScript: driver,
    configPath: overlay,
    binArgs: [overlay, JSON.stringify(plan)],
    tsconfigPath: repoTsconfig,
  })
  const json = /P4-11-MULTI (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`driver reported nothing usable:\n${stdout}`)
  return JSON.parse(json) as Report
}

/**
 * A turn whose first `failures` requests fail with a retryable 503 before one
 * succeeds.
 * @param failures - how many requests fail first.
 * @returns the turn's outcomes, in request order.
 */
function serverFailures(failures: number): string[] {
  return [...Array.from({ length: failures }, () => 'SERVER'), 'OK']
}

/**
 * Requests the loop sent again: every conversation request after a turn's first.
 * @param report - the driver's report.
 * @returns the resend count across the run.
 */
function resends(report: Report): number {
  return report.turns.reduce((total, turn) => total + turn.requests - 1, 0)
}

describe('P4-11 acceptance[1]: every plugin that retries draws on one run budget', () => {
  it('P4-11 acceptance[1] on the shipped profile: a second plugin cannot resend once the run budget is spent', async () => {
    // llm-retry spends the whole allowance, 4 + 4 + 2 over three turns. The
    // fourth turn overflows; compaction's resend is then an eleventh retry,
    // and the run must refuse it.
    const report = await run('p4-11 multi: A', headless, {
      profile: 'headless',
      turns: [
        { outcomes: serverFailures(4), padded: true },
        { outcomes: serverFailures(4), padded: true },
        { outcomes: serverFailures(2), padded: true },
        { outcomes: ['OVERFLOW', 'OK'] },
      ],
      probe: true,
    })

    // Every turn reached the model, and llm-retry's ten really happened.
    expect(report.turns.map(turn => turn.retryStarted)).toEqual([4, 4, 2, 0])
    expect(resends(report)).toBe(10)
    expect(report.usage?.retriesUsed).toBe(10)
    expect(report.turns[3]).toMatchObject({ requests: 1, end: 'CONTEXT_WINDOW_EXCEEDED' })
    // A reading of the budget's state, not a reason the product reported.
    expect(report.probe).toEqual({ admitted: false, reason: 'retry-cap-reached' })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('P4-11 acceptance[1] on the shipped profile: the overflow resend is charged to the same run', async () => {
    // Four llm-retry retries, then an overflow compaction recovers from: five
    // resends, and each must be on the run's account.
    const report = await run('p4-11 multi: B', headless, {
      profile: 'headless',
      turns: [
        { outcomes: serverFailures(4), padded: true },
        { outcomes: ['OVERFLOW', 'OK'] },
      ],
    })

    // The overflow was recovered rather than refused: compaction closed its
    // bracket and the loop sent the request again.
    expect(report.turns[1]).toMatchObject({ compactionStarted: 1, compactionCompleted: 1, requests: 2, end: 'completed' })
    expect(report.usage?.retriesUsed).toBe(5)
    expect(resends(report)).toBe(5)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('P4-11 acceptance[1] on the shipped profile: llm-retry stops below its own cap because another plugin spent', async () => {
    // The session's first request overflows. Compaction admits its resend
    // against the run before compacting, and a short first request leaves it
    // nothing it can shrink, so no resend follows — but the admission already
    // spent one. llm-retry then spends 4 + 4, and in the fourth turn the run
    // allows one retry where llm-retry's own policy allows five.
    const report = await run('p4-11 multi: C', headless, {
      profile: 'headless',
      turns: [
        { outcomes: ['OVERFLOW', 'OK'] },
        { outcomes: serverFailures(4) },
        { outcomes: serverFailures(4) },
        { outcomes: serverFailures(3) },
      ],
    })

    expect(report.turns[0]).toMatchObject({ requests: 1, end: 'CONTEXT_WINDOW_EXCEEDED' })
    expect(report.turns.slice(1, 3).map(turn => turn.retryStarted)).toEqual([4, 4])
    expect(resends(report)).toBe(9)
    expect(report.turns[3]).toMatchObject({ retryStarted: 1, end: 'SERVER' })
    expect(report.usage?.retriesUsed).toBe(10)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('P4-11 acceptance[1] on the shipped acp profile: a session\'s MCP reconnect spends the same run budget as llm-retry', async () => {
    // llm-retry spends 4 + 4 + 1. The session's MCP server is then killed, and
    // its supervisor's reconnect is the run's tenth retry, so the fourth
    // turn's llm-retry retry is refused.
    const report = await run('p4-11 multi: E', acp, {
      profile: 'acp',
      turns: [
        { outcomes: serverFailures(4) },
        { outcomes: serverFailures(4) },
        { outcomes: serverFailures(1) },
        { outcomes: serverFailures(1) },
      ],
      dropMcpAfterTurn: 3,
    })

    // The server really dropped and really came back: two processes, each
    // serving its tools.
    expect(report.mcp?.map(generation => generation.listed)).toEqual([true, true])
    expect(report.usageBeforeDrop?.retriesUsed).toBe(9)
    expect(report.usageAfterReconnect?.retriesUsed).toBe(10)
    expect(report.turns[3]).toMatchObject({ requests: 1, retryStarted: 0, end: 'SERVER' })
    expect(report.usage?.retriesUsed).toBe(10)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

describe('P4-11 acceptance[0]: a permanent failure is not retried', () => {
  it('P4-11 acceptance[0] on the shipped profile: a permanent failure is neither retried nor charged', async () => {
    // Two permanent failures, a rejected request and a rejected credential,
    // then a turn with one retryable failure as the control: the retry path is
    // live, so the first two turns' zero retries are the policy's doing.
    const report = await run('p4-11 multi: D', headless, {
      profile: 'headless',
      turns: [
        { outcomes: ['INVALID'] },
        { outcomes: ['AUTH'] },
        { outcomes: serverFailures(1) },
      ],
    })

    expect(report.turns[0]).toMatchObject({ requests: 1, retryStarted: 0, end: 'INVALID_REQUEST' })
    expect(report.turns[1]).toMatchObject({ requests: 1, retryStarted: 0, end: 'AUTH' })
    expect(report.turns[2]).toMatchObject({ requests: 2, retryStarted: 1, end: 'completed' })
    expect(report.usage?.retriesUsed).toBe(1)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
