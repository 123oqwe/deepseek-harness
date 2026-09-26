/**
 * The manifest-builder gate's own specification (§12.39, B-645).
 *
 * The gate exists because a behavioural case cannot tell an `idempotencyKey`
 * that came from an `ActionManifest` from one assembled beside a payload —
 * BLOCKED-143's defect. It went red for the opposite reason: §12.33 routed both
 * dispatch paths through `appendManifestThenGate`, so construction moved inside
 * the owning package and a scan for direct `createActionManifest` callers found
 * none while every dispatch was building a real record.
 *
 * These cases pin the corrected subject against the REAL repository, because
 * that is what the gate reads. A fixture would prove the regex works; only the
 * real tree can say whether this repository still constructs manifests.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { manifestBuilderCallers } from './verify-manifest-constructed.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** One production file's source, read the way the gate reads it. */
function source(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8')
}

describe('verify-manifest-constructed counts construction through the façade and shared helpers too', () => {
  it('counts a caller that reaches the builder only through a shared helper', () => {
    // `ptc.ts` is the code-mode dispatch path. Since B-615 it constructs a
    // manifest on every sub-dispatch through `appendManifestAndDecide`, an
    // exported helper that calls the façade, and names neither entry point
    // itself. A gate that counted only direct callers reported the helper's
    // file instead (B-645).
    const { callers, helpers } = manifestBuilderCallers()
    expect(callers).toContain('packages/core/tools/src/ptc.ts')
    expect(source('packages/core/tools/src/ptc.ts')).not.toMatch(/\b(?:createActionManifest|appendManifestThenGate)\s*\(/u)
    expect(source('packages/core/tools/src/ptc.ts')).toMatch(/\bappendManifestAndDecide\s*\(/u)
    expect(helpers).toContainEqual({
      file: 'packages/core/tools/src/external-effect.ts',
      name: 'appendManifestAndDecide',
      reaches: ['appendManifestThenGate'],
    })
  })

  it('follows a helper that builds the manifest without the façade', () => {
    // The other direction: a path that never reaches `appendManifestThenGate`
    // still counts when it calls the builder. `decideUnrecordedAction`
    // constructs the manifest of a direct call made with no agent, which has
    // no session to append it to.
    const { helpers } = manifestBuilderCallers()
    expect(helpers).toContainEqual({
      file: 'packages/core/tools/src/external-effect.ts',
      name: 'decideUnrecordedAction',
      reaches: ['createActionManifest'],
    })
  })

  it('reports all three dispatch paths and not the helpers\' module, which is what must[2] asks of a no-bypass claim', () => {
    // Native, code-mode and the public `ToolRuntime.execute` seam. One of them
    // alone would satisfy "has a production caller" while leaving the others
    // free to assemble a payload beside a manifest, which is the arrangement
    // BLOCKED-143 found. `external-effect.ts` only holds the helpers.
    const { callers } = manifestBuilderCallers()
    expect([...callers].sort()).toEqual([
      'packages/core/agent-loop/src/tool-calls.ts',
      'packages/core/tools/src/index.ts',
      'packages/core/tools/src/ptc.ts',
    ])
  })

  it('requires the owning package to declare EVERY builder it accepts, so a zero means a broken scan', () => {
    // The positive control, widened with the subject: while it checked only
    // `createActionManifest`, renaming the façade would have left the gate
    // counting a name nothing declares and reporting a confident zero.
    const { ownerDefines, scanned } = manifestBuilderCallers()
    expect(ownerDefines).toBe(true)
    expect(scanned).toBeGreaterThan(500)
  })
})
