/**
 * Controls for run-registry-gates' memory guard and exit code, as pure functions. The runner's own refusal is
 * exercised with `--min-free-percent 100`, not here.
 */
import { describe, expect, it } from 'vitest'

import { gateSetExitCode, memoryVerdict, stopsTheSet } from './run-registry-gates.mjs'

describe('memoryVerdict', () => {
  it('refuses a gate below the threshold and names both numbers', () => {
    expect(memoryVerdict(19, 20)).toStrictEqual({ run: false, reason: 'memory free 19% < 20%' })
  })

  it('starts a gate at the threshold, so the floor itself is allowed', () => {
    expect(memoryVerdict(20, 20)).toStrictEqual({ run: true })
  })

  it('starts a gate when free memory cannot be read, because an unknown reading is not a low one', () => {
    expect(memoryVerdict(undefined, 20)).toStrictEqual({ run: true })
  })
})

describe('gateSetExitCode', () => {
  it('exits 0 when every gate passed', () => {
    expect(gateSetExitCode([{ gate: 'a', outcome: 'PASS' }, { gate: 'b', outcome: 'PASS' }])).toBe(0)
  })

  it('exits 1 when a gate failed, even when a later gate could not run', () => {
    expect(gateSetExitCode([
      { gate: 'a', outcome: 'FAIL', detail: 'exit 1' },
      { gate: 'b', outcome: 'CANNOT_RUN', detail: 'memory free 5% < 20%' },
      { gate: 'c', outcome: 'NOT_RUN' },
    ])).toBe(1)
  })

  it('exits 2 when a gate could not run and the rest were not run', () => {
    expect(gateSetExitCode([
      { gate: 'a', outcome: 'PASS' },
      { gate: 'b', outcome: 'CANNOT_RUN', detail: 'memory free 5% < 20%' },
      { gate: 'c', outcome: 'NOT_RUN' },
    ])).toBe(2)
  })

  it('exits 2 when a gate was killed by a signal and none failed', () => {
    expect(gateSetExitCode([{ gate: 'a', outcome: 'PASS' }, { gate: 'b', outcome: 'KILLED', detail: 'SIGKILL' }])).toBe(2)
  })
})

describe('run-registry-gates: which outcomes stop the set', () => {
  it('stops on a gate that could not start and on one the machine killed, and not on a red or a pass', () => {
    expect(stopsTheSet('CANNOT_RUN')).toBe(true)
    expect(stopsTheSet('KILLED')).toBe(true)
    expect(stopsTheSet('FAIL')).toBe(false)
    expect(stopsTheSet('PASS')).toBe(false)
    expect(stopsTheSet('NOT_RUN')).toBe(false)
  })
})
