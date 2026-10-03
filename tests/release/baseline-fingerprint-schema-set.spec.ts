/**
 * P0-01 acceptance[1] (BLOCKED-305 condition [1]), the key-schema-set gap A-575
 * reported: the recorded key-schema set must be DERIVED from the SDK protocol
 * package, not a fixed list of file paths, so a key schema source file ADDED to
 * the package after capture drifts and `baseline-fingerprint.mjs verify` names
 * it.
 *
 * Red first for B-703 (§21.4: the fix is not read). Today the script's
 * `PROTOCOL_SCHEMA_PATHS` is a fixed pair of file paths
 * (`packages/sdk/protocol/src/types.ts`, `packages/core/session/src/known-event-types.ts`),
 * so a new protocol schema source file is outside the set, is never
 * fingerprinted, and verify passes blind to it. B-703 derives the protocol key
 * schemas from the package, so the added file is in the set and verify fails
 * naming it.
 *
 * It reuses the shared fingerprint fixture — a committed throwaway checkout
 * whose `packages/sdk/protocol/src/types.ts` is its one protocol schema — and
 * the real `capture`/`verify` subprocess boundary, touching no frozen spec. The
 * `spec/*.schema.json` half of the set is already a directory scan and is
 * covered by the classes spec; this case is the protocol half, the pair that is
 * hard-coded.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { git, makeFingerprintFixture, runFingerprint, write } from './fingerprint-fixture.ts'

/** One drift entry as verify reports it. */
interface Drift {
  readonly path: string
}

/** A key schema source file added in the protocol package, beside the fixture's existing `types.ts`. */
const ADDED_PROTOCOL_SCHEMA = 'packages/sdk/protocol/src/commands.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('P0-01 acceptance[1]: the key-schema set is derived from the SDK protocol package, not a fixed path list (red first for B-703)', () => {
  it('a key schema source file added to the protocol package after capture fails verify and names it', () => {
    const root = makeFingerprintFixture()
    roots.push(root)
    const captured = runFingerprint('capture', root)
    expect(captured.status, `capture stderr: ${captured.stderr}`).toBe(0)
    // Add a new protocol schema source file beside the fixture's own types.ts,
    // committed so it is tracked content the next verify must account for.
    write(root, ADDED_PROTOCOL_SCHEMA, 'export interface Command {\n  name: string\n}\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'add a protocol schema source file after capture'])
    const verified = runFingerprint('verify', root)
    const report = join(root, '.dsh/rebase-report.json')
    const drift = existsSync(report) ? (JSON.parse(readFileSync(report, 'utf8')) as { drift: Drift[] }).drift : []
    const detail = JSON.stringify({ status: verified.status, drift, stderr: verified.stderr.slice(-400) })

    // RED today: the fixed pair does not include the added file, so verify is
    // blind to it and passes. After B-703 the set is derived from the package,
    // so the added file drifts and verify names it.
    expect(verified.status, detail).not.toBe(0)
    expect(drift.map(entry => entry.path), detail).toContain(ADDED_PROTOCOL_SCHEMA)
  })
})
