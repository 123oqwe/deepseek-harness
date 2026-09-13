import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  METRIC_PROCESS_CPU_TIME,
  METRIC_PROCESS_DISK_IO,
  METRIC_PROCESS_MEMORY_USAGE,
  METRIC_PROCESS_NETWORK_IO,
  METRIC_PROCESS_THREAD_COUNT,
  METRIC_PROCESS_UPTIME,
} from '@opentelemetry/semantic-conventions/incubating'
import * as budget from '@deepseek-ai/dsh-resource-budget'
import {
  BUDGET_DIMENSIONS,
  BudgetAccountError,
  BudgetLedger,
  CONSUMED_DIMENSIONS,
  HELD_DIMENSIONS,
  METERING_ERROR_BOUND,
  PROCESS_SEMCONV_METRICS,
  type BudgetAccountId,
  type BudgetAmounts,
  type BudgetDimension,
  type BudgetLimits,
} from '@deepseek-ai/dsh-resource-budget'

const id = (value: string): BudgetAccountId => brandString<BudgetAccountId>(value)

/** The limit field and a refusal reason for each dimension, restated so a wrong mapping in the ledger is caught. */
const DIMENSION_CASES: readonly { dimension: BudgetDimension; field: keyof BudgetLimits; reason: string }[] = [
  { dimension: 'wallClockMs', field: 'maxWallClockMs', reason: 'wall-clock-limit-reached' },
  { dimension: 'cpuMillicores', field: 'cpuMillicores', reason: 'cpu-limit-reached' },
  { dimension: 'memoryBytes', field: 'memoryBytes', reason: 'memory-limit-reached' },
  { dimension: 'diskBytes', field: 'diskBytes', reason: 'disk-limit-reached' },
  { dimension: 'processes', field: 'maxProcesses', reason: 'process-limit-reached' },
  { dimension: 'networkBytes', field: 'maxNetworkBytes', reason: 'network-bytes-limit-reached' },
  { dimension: 'toolCalls', field: 'maxToolCalls', reason: 'tool-call-limit-reached' },
  { dimension: 'agents', field: 'maxAgents', reason: 'agent-limit-reached' },
]

/** A run account with one limit set, and nothing above it. */
function runWith(field: keyof BudgetLimits, limit: number): BudgetLedger {
  const ledger = new BudgetLedger()
  ledger.open(id('run'), { scope: 'run', limits: { [field]: limit } })
  return ledger
}

describe('P3-10 must[0]: a budget bounds eight dimensions per tenant, run and action', () => {
  it('names exactly the eight dimensions the clause lists, each held or consumed except wall clock', () => {
    expect([...BUDGET_DIMENSIONS].sort()).toEqual(['agents', 'cpuMillicores', 'diskBytes', 'memoryBytes', 'networkBytes', 'processes', 'toolCalls', 'wallClockMs'])
    expect([...HELD_DIMENSIONS, ...CONSUMED_DIMENSIONS, 'wallClockMs'].sort()).toEqual([...BUDGET_DIMENSIONS].sort())
  })

  for (const { dimension, field, reason } of DIMENSION_CASES) {
    it(`refuses a reservation on ${dimension} past its limit, naming the dimension, the limit and what would have been observed`, () => {
      const ledger = runWith(field, 10)
      const amounts: BudgetAmounts = { [dimension]: 11 }
      expect(ledger.reserve(id('run'), amounts).decision).toEqual({ admitted: false, reason, limit: 10, observed: 11 })
    })

    it(`admits a reservation on ${dimension} exactly at its limit`, () => {
      expect(runWith(field, 10).reserve(id('run'), { [dimension]: 10 }).decision).toEqual({ admitted: true })
    })
  }

  it('treats a zero or absent limit as unlimited, as the loop budget does', () => {
    expect(runWith('maxToolCalls', 0).reserve(id('run'), { toolCalls: 1_000_000 }).decision.admitted).toBe(true)
    const ledger = new BudgetLedger()
    ledger.open(id('run'), { scope: 'run', limits: {} })
    expect(ledger.reserve(id('run'), { memoryBytes: 2 ** 40 }).decision.admitted).toBe(true)
  })

  it('refuses to open an account under a parent whose scope is not strictly wider', () => {
    const ledger = new BudgetLedger()
    ledger.open(id('run'), { scope: 'run', limits: {} })
    expect(() => { ledger.open(id('sibling-run'), { scope: 'run', limits: {} }, id('run')) }).toThrow(BudgetAccountError)
    expect(() => { ledger.open(id('tenant'), { scope: 'tenant', limits: {} }, id('run')) }).toThrow(BudgetAccountError)
    expect(() => { ledger.open(id('action'), { scope: 'action', limits: {} }, id('missing')) }).toThrow(BudgetAccountError)
  })
})

describe('P3-10 must[1]: a reservation is recorded against every enclosing budget', () => {
  it('returns held dimensions on release and keeps consumed ones', () => {
    const ledger = new BudgetLedger()
    ledger.open(id('run'), { scope: 'run', limits: { memoryBytes: 100, maxToolCalls: 5 } })
    const result = ledger.reserve(id('run'), { memoryBytes: 60, toolCalls: 1 })
    if (!('reservation' in result)) throw new Error('expected an admitted reservation')
    ledger.release(result.reservation)
    expect(ledger.usage(id('run')).held.memoryBytes).toBe(0)
    expect(ledger.usage(id('run')).consumed.toolCalls).toBe(1)
    expect(ledger.reserve(id('run'), { memoryBytes: 100 }).decision.admitted).toBe(true)
  })

  it('applies a refused reservation to no account at all, including the ones that would have admitted it', () => {
    const ledger = new BudgetLedger()
    ledger.open(id('tenant'), { scope: 'tenant', limits: { maxToolCalls: 3 } })
    ledger.open(id('run'), { scope: 'run', limits: { maxToolCalls: 100 } }, id('tenant'))
    expect(ledger.reserve(id('run'), { toolCalls: 4 }).decision).toEqual({ admitted: false, reason: 'tool-call-limit-reached', limit: 3, observed: 4 })
    expect(ledger.usage(id('run')).consumed.toolCalls).toBe(0)
    expect(ledger.usage(id('tenant')).consumed.toolCalls).toBe(0)
  })

  it('checks wall clock as a ceiling per reservation, so parallel work does not add elapsed time', () => {
    const ledger = runWith('maxWallClockMs', 1_000)
    expect(ledger.reserve(id('run'), { wallClockMs: 1_000 }).decision.admitted).toBe(true)
    expect(ledger.reserve(id('run'), { wallClockMs: 1_000 }).decision.admitted).toBe(true)
  })
})

describe('P3-10 acceptance[1]: a cumulative budget cannot be bypassed by splitting across subagents', () => {
  it('stops fifty subagents sharing their parent run budget at the run limit, not at each subagent\'s own', () => {
    // validation[1]: 50 child agents share the parent's budget. Each child's
    // action account allows 100 tool calls, which fifty of them could exceed
    // fifty times over if the children were budgets of their own.
    const ledger = new BudgetLedger()
    ledger.open(id('run'), { scope: 'run', limits: { maxToolCalls: 100 } })
    let admitted = 0
    let refusal: unknown
    for (let child = 0; child < 50; child += 1) {
      ledger.open(id(`child-${String(child)}`), { scope: 'action', limits: { maxToolCalls: 100 } }, id('run'))
      for (let call = 0; call < 3; call += 1) {
        const result = ledger.reserve(id(`child-${String(child)}`), { toolCalls: 1 })
        if (result.decision.admitted) admitted += 1
        else refusal ??= result.decision
      }
    }
    expect(admitted).toBe(100)
    expect(refusal).toEqual({ admitted: false, reason: 'tool-call-limit-reached', limit: 100, observed: 101 })
    expect(ledger.usage(id('run')).consumed.toolCalls).toBe(100)
  })

  it('holds a tenant limit across its runs the same way', () => {
    const ledger = new BudgetLedger()
    ledger.open(id('tenant'), { scope: 'tenant', limits: { memoryBytes: 1_000 } })
    ledger.open(id('run-a'), { scope: 'run', limits: { memoryBytes: 1_000 } }, id('tenant'))
    ledger.open(id('run-b'), { scope: 'run', limits: { memoryBytes: 1_000 } }, id('tenant'))
    expect(ledger.reserve(id('run-a'), { memoryBytes: 700 }).decision.admitted).toBe(true)
    expect(ledger.reserve(id('run-b'), { memoryBytes: 700 }).decision).toEqual({ admitted: false, reason: 'memory-limit-reached', limit: 1_000, observed: 1_400 })
  })
})

describe('P3-10 acceptance[2]: the metering error bound is declared as a number before anything is measured', () => {
  it('declares a finite bound for every dimension, exact for the counted ones and within 10% for the sampled ones', () => {
    for (const dimension of BUDGET_DIMENSIONS) expect(Number.isFinite(METERING_ERROR_BOUND[dimension])).toBe(true)
    expect(['wallClockMs', 'processes', 'toolCalls', 'agents'].map(d => METERING_ERROR_BOUND[d as BudgetDimension])).toEqual([0, 0, 0, 0])
    expect(['cpuMillicores', 'memoryBytes', 'diskBytes', 'networkBytes'].map(d => METERING_ERROR_BOUND[d as BudgetDimension])).toEqual([0.1, 0.1, 0.1, 0.1])
  })
})

describe('P3-10 must[3]/must[4]: budgets are metering and hard-limit primitives, with no scheduling fairness', () => {
  it('exports no fairness, priority, weight or share vocabulary for P4-10 to find already decided here', () => {
    expect(Object.keys(budget).filter(name => /fair|priorit|weight|share|starv|quantum/i.test(name))).toEqual([])
    expect(Object.keys(budget)).not.toContain('schedule')
  })
})

describe('P3-10 standard: OTel process.* semconv names', () => {
  it('reconciles four dimensions against the OTel process.* semconv names of the pinned release, and leaves the other four unmapped', () => {
    expect(PROCESS_SEMCONV_METRICS).toEqual({
      cpuMillicores: METRIC_PROCESS_CPU_TIME,
      memoryBytes: METRIC_PROCESS_MEMORY_USAGE,
      diskBytes: METRIC_PROCESS_DISK_IO,
      networkBytes: METRIC_PROCESS_NETWORK_IO,
    })
    // Near misses the mapping must not take: thread count is not a process
    // count, and uptime is a process's age, not an action's wall time.
    expect(Object.values(PROCESS_SEMCONV_METRICS)).not.toContain(METRIC_PROCESS_THREAD_COUNT)
    expect(Object.values(PROCESS_SEMCONV_METRICS)).not.toContain(METRIC_PROCESS_UPTIME)
  })
})
