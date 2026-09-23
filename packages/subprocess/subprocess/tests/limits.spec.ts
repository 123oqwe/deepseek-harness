import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import {
  assertLimitsEnforceable,
  requestedLimitDimensions,
  SubprocessLimitsRefusedError,
  SubprocessRuntime,
} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'

/** A provider that answers nothing about limits of its own, so the base answer is what is read. */
class SilentProvider extends SubprocessRuntime {
  resolveExecutable(command: string): Promise<string> {
    return Promise.resolve(`/bin/${command}`)
  }

  spawn(): SubprocessHandle {
    throw new Error('this fixture never launches')
  }

  spawnTerminal(): Promise<SubprocessTerminalHandle> {
    return Promise.resolve({
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: () => Promise.resolve(),
      inspectForeground: () => Promise.resolve({ processGroupId: 1, inputWaiting: true }),
      signalForeground: () => Promise.resolve(1),
      terminate: () => Promise.resolve(),
    })
  }
}

describe('P3-10 R1 — the subprocess seam carries ceilings and refuses what a provider cannot hold', () => {
  it('reads no ceiling from an absent or empty limits object', () => {
    expect(requestedLimitDimensions(undefined)).toEqual([])
    expect(requestedLimitDimensions({})).toEqual([])
    expect(requestedLimitDimensions({ cpuMillicores: undefined })).toEqual([])
  })

  it('names every set ceiling, in cpu, memory, processes order', () => {
    expect(requestedLimitDimensions({ maxProcesses: 8, cpuMillicores: 500, memoryBytes: 1024 }))
      .toEqual(['cpu', 'memory', 'processes'])
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])('refuses a ceiling of %s as malformed rather than reading it', (value) => {
    expect(() => requestedLimitDimensions({ memoryBytes: value })).toThrow(/limits\.memoryBytes must be a positive integer/)
  })

  it.each([1, 5, 15])('refuses a CPU ceiling of %s millicores, which is not a whole percent of one CPU', (value) => {
    expect(() => requestedLimitDimensions({ cpuMillicores: value })).toThrow(/limits\.cpuMillicores must be a positive multiple of 10/)
  })

  it.each([10, 1000])('accepts a CPU ceiling of %s millicores, a whole percent of one CPU', (value) => {
    expect(requestedLimitDimensions({ cpuMillicores: value })).toEqual(['cpu'])
  })

  it('lets a spawn through when the provider holds every dimension it names', () => {
    expect(() => { assertLimitsEnforceable({ memoryBytes: 1024, maxProcesses: 4 }, ['cpu', 'memory', 'processes']) }).not.toThrow()
    expect(() => { assertLimitsEnforceable(undefined, []) }).not.toThrow()
  })

  it('REFUSES a spawn naming a dimension the provider cannot hold, and names exactly those', () => {
    let caught: unknown
    try {
      assertLimitsEnforceable({ cpuMillicores: 250, memoryBytes: 1024, maxProcesses: 4 }, ['memory'])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(SubprocessLimitsRefusedError)
    const refusal = caught as SubprocessLimitsRefusedError
    expect(refusal.name).toBe('SubprocessLimitsRefusedError')
    expect(refusal.refused).toEqual(['cpu', 'processes'])
    expect(refusal.enforceable).toEqual(['memory'])
    expect(refusal.message).toContain('it can hold: memory')
  })

  it('says a provider that can hold nothing holds nothing', () => {
    expect(() => { assertLimitsEnforceable({ maxProcesses: 4 }, []) }).toThrow(/it can hold: none/)
  })

  it('answers no enforceable dimension for a provider that does not claim any', async () => {
    const ctx = new Context()
    await ctx.plugin(SilentProvider)
    expect(ctx.subprocess.enforceableLimits()).toEqual([])
  })
})
