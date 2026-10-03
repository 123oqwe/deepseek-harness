/**
 * B-702: a benchmark run with patches from the runner's `--patch` measured a
 * modified product, and both reports must say so rather than pass it off as
 * the shipped composition. The runner states the product through
 * `productComposition` and `compositionLine`.
 */

import { describe, expect, it } from 'vitest'

import { compositionLine, productComposition } from '../../benchmarks/harness-capability/report.ts'

describe('P0-08 benchmark: a run with extra patches is marked as a modified composition (B-702)', () => {
  it('marks a run with an extra patch as modified and names the patch and its sha256; a run with none states the shipped composition', () => {
    const patch = { path: '/tmp/disable-guard.patch.yml', sha256: 'a'.repeat(64) }
    const modified = productComposition([patch])
    expect(modified).toEqual({ modified: true, extraPatches: [patch] })
    expect(compositionLine(modified)).toContain('MODIFIED composition')
    expect(compositionLine(modified)).toContain(`${patch.path} (sha256 ${patch.sha256})`)

    const shipped = productComposition([])
    expect(shipped).toEqual({ modified: false, extraPatches: [] })
    expect(compositionLine(shipped)).toBe('Product: shipped composition')
  })
})
