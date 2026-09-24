/**
 * Epic P0-02 acceptance[1] on the runtime module `src/index.ts`, which
 * `boundary.spec.ts` does not read: that file checks the type surface
 * `src/types.ts`.
 *
 * Model-visible text is judged by reading every string literal the module
 * holds, not by searching for known phrases: the list below is complete, so
 * any new literal, including one a later change addresses to a model, reddens
 * the first case until someone classifies it. The directory guard keeps the
 * list meaningful: a runtime file added beside `index.ts` would hold literals
 * this walk never reads.
 *
 * The second case states what the module imports and exports. It does not
 * claim the module has no path into a model's context: `Context` from
 * `@deepseek-ai/cordis` is a service bus. What reaches a model on a real
 * launch is observed by `apps/cli/tests/trust-kernel-model-input.spec.ts`.
 */

import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { KERNEL_SRC_DIR, readRuntimeModuleExports, readRuntimeModuleSyntax } from './fixtures/runtime-surface.ts'

/** Every string literal `src/index.ts` holds, grouped by what it is. */
const EXPECTED_LITERALS = [
  // The service key pinTrustKernel provides, reads back and seals, 6 uses.
  ...Array<string>(6).fill('trustKernel'),
  // The algorithm id of the per-kernel signing keypair.
  'ed25519',
  // The verdict of a kernel constructed without a decider.
  'deny',
  // Errors thrown to the direct caller: 2 unreachable-state guards in
  // pinTrustKernel and the forged-handle refusal shared by sign and verify.
  'unreachable: ctx.provide did not register the trustKernel isolate key',
  'unreachable: the root fiber has no store',
  'trust kernel: this signatureRoots handle was not minted by createTrustKernel',
  'trust kernel: this signatureRoots handle was not minted by createTrustKernel',
]

/** The runtime entrypoints the module exports as values. */
const EXPECTED_VALUE_EXPORTS = [
  'configuredTrustAnchors',
  'createTrustKernel',
  'pinTrustKernel',
  'signWithSignatureRoots',
  'verifyWithSignatureRoots',
]

/** Export names that would make the module loadable as a Cordis plugin entry. */
const PLUGIN_ENTRY_EXPORTS = ['apply', 'Config', 'inject', 'default']

describe('Trust Kernel runtime module src/index.ts (Epic P0-02 acceptance[1])', () => {
  it('authors no model-facing text: src/ holds only index.ts and types.ts, and every string literal in src/index.ts is a service key, an algorithm id, a verdict or a caller-facing error, and the list is complete', () => {
    expect(readdirSync(KERNEL_SRC_DIR).toSorted()).toEqual(['index.ts', 'types.ts'])
    const syntax = readRuntimeModuleSyntax()
    // Parse guard: an empty or wrong file would also yield a short list.
    expect(syntax.functionNames).toEqual(expect.arrayContaining(['createTrustKernel', 'pinTrustKernel']))
    expect(syntax.templateExpressions).toBe(0)
    expect(syntax.literals.toSorted()).toEqual(EXPECTED_LITERALS.toSorted())
  })

  it('imports only node:crypto, @deepseek-ai/cordis and its own types, and exports no Cordis plugin entry', () => {
    const specifiers = [...new Set(readRuntimeModuleSyntax().moduleSpecifiers)].toSorted()
    expect(specifiers).toEqual(['./types.ts', '@deepseek-ai/cordis', 'node:crypto'])
    const exported = readRuntimeModuleExports()
    expect(exported.filter(entry => entry.isValue).map(entry => entry.name).toSorted()).toEqual(EXPECTED_VALUE_EXPORTS)
    const names = exported.map(entry => entry.name)
    // Resolution guard: the `export type *` re-exports of src/types.ts are
    // in the list, so the names below are checked on both files.
    expect(names).toContain('TrustKernel')
    for (const name of PLUGIN_ENTRY_EXPORTS) expect(names, `export ${name}`).not.toContain(name)
  })
})
