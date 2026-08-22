/**
 * Runtime invariants for the Trust Kernel.
 *
 * These assertions protect the kernel's immutability boundary: no plugin
 * may replace, override, or unregister the kernel's policy enforcement,
 * audit chain, or signature verifier.
 *
 * @module @deepseek-ai/dsh-trust-kernel/invariant
 */

import type { TrustKernel, TrustKernelHandle } from './types.ts'

/** The singleton kernel handle, set once at boot. */
let kernelHandle: TrustKernelHandle | undefined
let kernelInstance: TrustKernel | undefined

/** Assert that a kernel has been initialized. */
export function assertKernelInitialized(): void {
  if (kernelInstance === undefined) {
    throw new Error('Trust Kernel not initialized: call initTrustKernel before any plugin loads')
  }
}

/** Return the kernel handle if initialized, otherwise throw. */
export function requireKernel(): TrustKernel {
  if (kernelInstance === undefined) {
    throw new Error('Trust Kernel not initialized: call initTrustKernel before any plugin loads')
  }
  return kernelInstance
}

/** Return the kernel handle if initialized, otherwise undefined. */
export function getKernel(): TrustKernel | undefined {
  return kernelInstance
}

/**
 * Set the kernel singleton. Called exactly once at boot, before any
 * Cordis Context is created. Subsequent calls throw.
 */
export function setKernel(handle: TrustKernelHandle, kernel: TrustKernel): void {
  if (kernelInstance !== undefined) {
    throw new Error('Trust Kernel already initialized: re-initialization is forbidden')
  }
  kernelHandle = handle
  kernelInstance = kernel
}

/**
 * Reset the kernel singleton. Only for tests; production code must never call this.
 */
export function resetKernelForTesting(): void {
  kernelHandle = undefined
  kernelInstance = undefined
}

/** Check whether the kernel has been initialized. */
export function isKernelInitialized(): boolean {
  return kernelInstance !== undefined
}

/** The kernel handle, or undefined if not initialized. */
export function getKernelHandle(): TrustKernelHandle | undefined {
  return kernelHandle
}
