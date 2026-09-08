/**
 * The manifest-builder gate's own specification (§12.39).
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

describe('verify-manifest-constructed counts construction through the façade too', () => {
  it('counts a caller that reaches ONLY the façade, never the builder directly', () => {
    // The case §12.39 turns on. `ptc.ts` is the code-mode dispatch path: it
    // constructs a manifest on every sub-dispatch and does so exclusively
    // through `appendManifestThenGate`. A gate that counted only direct
    // `createActionManifest` calls reported it as no caller at all.
    const { callers } = manifestBuilderCallers()
    expect(callers).toContain('packages/core/tools/src/ptc.ts')
    expect(source('packages/core/tools/src/ptc.ts')).not.toMatch(/\bcreateActionManifest\s*\(/u)
    expect(source('packages/core/tools/src/ptc.ts')).toMatch(/\bappendManifestThenGate\s*\(/u)
  })

  it('reports both dispatch paths, which is what must[2] asks of a no-bypass claim', () => {
    // Native and code-mode. One of them alone would satisfy "has a production
    // caller" while leaving the other free to assemble a payload beside a
    // manifest, which is the arrangement BLOCKED-143 found.
    const { callers } = manifestBuilderCallers()
    expect([...callers].sort()).toEqual([
      'packages/core/agent-loop/src/tool-calls.ts',
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
