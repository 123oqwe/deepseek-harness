import { describe, expect, it, vi } from 'vitest'
import { enforceTrustKernelPosture, resolveTrustKernelInsecureOptIn } from '../src/profile-boot.ts'

describe('resolveTrustKernelInsecureOptIn', () => {
  it('stays opted out when the switch is unset or empty', () => {
    expect(resolveTrustKernelInsecureOptIn(undefined)).toBe(false)
    expect(resolveTrustKernelInsecureOptIn('')).toBe(false)
  })

  it('opts in on ANY non-empty value, including falsy-looking ones', () => {
    for (const value of ['1', '0', 'false', 'no']) {
      expect(resolveTrustKernelInsecureOptIn(value)).toBe(true)
    }
  })
})

describe('enforceTrustKernelPosture', () => {
  it('is a no-op when initialized, opt-in or not', () => {
    const warn = vi.fn()
    expect(() => { enforceTrustKernelPosture(true, false, warn) }).not.toThrow()
    expect(() => { enforceTrustKernelPosture(true, true, warn) }).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails closed (throws, never warns) when uninitialized without the insecure opt-in', () => {
    const warn = vi.fn()
    expect(() => { enforceTrustKernelPosture(false, false, warn) }).toThrow(/Trust Kernel not initialized/)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and continues (never throws) when uninitialized with the insecure opt-in -- every call, a permanent warning, not a one-time notice', () => {
    const warn = vi.fn()
    expect(() => {
      enforceTrustKernelPosture(false, true, warn)
      enforceTrustKernelPosture(false, true, warn)
    }).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0]?.[0]).toContain('WARNING')
    expect(warn.mock.calls[0]?.[0]).toContain('never use in production')
  })

  it('defaults to a stderr write when no warn sink is supplied', () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      enforceTrustKernelPosture(false, true)
      expect(write).toHaveBeenCalledWith(expect.stringContaining('WARNING'))
    } finally {
      write.mockRestore()
    }
  })
})
