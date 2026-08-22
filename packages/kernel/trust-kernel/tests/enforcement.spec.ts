import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resetKernelForTesting, initTrustKernel, assertKernelInitialized, isKernelInitialized } from '../src/index.ts'

describe('P0-02 Trust Kernel Enforcement', () => {
  beforeEach(() =>{  resetKernelForTesting(); })
  afterEach(() =>{  resetKernelForTesting(); })

  it('assertKernelInitialized throws when kernel not initialized', () => {
    expect(() =>{  assertKernelInitialized(); }).toThrow()
  })

  it('assertKernelInitialized passes after initTrustKernel', () => {
    initTrustKernel({ insecure: true })
    expect(() =>{  assertKernelInitialized(); }).not.toThrow()
  })

  it('kernel can only be initialized once', () => {
    initTrustKernel({ insecure: true })
    expect(() => initTrustKernel({ insecure: true })).toThrow()
  })

  it('isKernelInitialized returns false after reset', () => {
    initTrustKernel({ insecure: true })
    expect(isKernelInitialized()).toBe(true)
    resetKernelForTesting()
    expect(isKernelInitialized()).toBe(false)
  })

  it('kernel initialized in test mode (insecure) allows operations', () => {
    initTrustKernel({ insecure: true })
    expect(isKernelInitialized()).toBe(true)
    // The assertKernelInitialized call is the enforcement point
    // used by tools/src/index.ts and subagent/src/index.ts
    expect(() =>{  assertKernelInitialized(); }).not.toThrow()
  })
})
