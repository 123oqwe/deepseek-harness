/**
 * Registry regeneration gate (R0-1 reproducibility).
 *
 * Proves `tests/first100/registry.json` is a deterministic extraction of the
 * pinned vendored planning sources under `spec/first100/sources/`:
 *   - green:  `--check` against the committed registry + committed sources exits 0
 *   - red:    an absent or byte-corrupt committed registry fails `--check`
 *   - red:    a tampered vendored source fails `--check` (sha pins + bytes differ)
 *   - honesty: the provenance block records extraction-from-pinned-sources and
 *              PENDING_MAINTAINER status for the 33 source-certified layer ids, 17 thresholds,
 *              and owner assignment — it must NOT self-report ACCEPTED or
 *              ADJUDICATED, because no maintainer adjudication has happened yet.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')
const EXTRACTOR = join(here, 'extract-registry.mjs')
const SOURCES = join(REPO_ROOT, 'spec/first100/sources')
const REGISTRY = join(REPO_ROOT, 'tests/first100/registry.json')

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'first100-registry-'))
  tempDirs.push(dir)
  return dir
}

interface CheckResult {
  status: number
  message: string
  stderr: string
}

/** Runs the extractor in --check mode; returns { status } (does not throw). */
function check(sources: string = SOURCES, out: string = REGISTRY): CheckResult {
  try {
    execFileSync(process.execPath, [EXTRACTOR, '--check', '--sources', sources, '--out', out], { stdio: 'pipe' })
    return { status: 0, message: '', stderr: '' }
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number(error.status)
      : 1
    const message = typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error)
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error
      ? (Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : String(error.stderr)).slice(0, 500)
      : ''
    return { status, message, stderr }
  }
}

describe('first100 registry regeneration', () => {
  it('green: committed registry is byte-identical to a fresh extraction of the pinned sources', () => {
    expect(check().status).toBe(0)
  })

  it('red: an absent committed registry fails --check', () => {
    const dir = tempDir()
    const status = check(SOURCES, join(dir, 'missing.json'))
    expect(status.status).not.toBe(0)
  })

  it('red: a byte-corrupt committed registry fails --check', () => {
    const dir = tempDir()
    const out = join(dir, 'registry.json')
    writeFileSync(out, '{ "schema": { "name": "tampered" }\n') // truncated + wrong bytes
    const status = check(SOURCES, out)
    expect(status.status).not.toBe(0)
  })

  it('red: a semantically-different committed registry fails --check', () => {
    const dir = tempDir()
    const out = join(dir, 'registry.json')
    const original = readFileSync(REGISTRY, 'utf8')
    writeFileSync(out, `${original}\n// trailing garbage\n`)
    const status = check(SOURCES, out)
    expect(status.status).not.toBe(0)
  })

  it('red: a tampered vendored matrix source fails --check', () => {
    const dir = tempDir()
    const sources = join(dir, 'sources')
    cpSync(SOURCES, sources, { recursive: true })
    const matrixPath = join(sources, 'first100-requirements-matrix.md')
    writeFileSync(matrixPath, `${readFileSync(matrixPath, 'utf8')}\n-- tampered by spec --\n`)
    const status = check(sources, REGISTRY)
    expect(status.status).not.toBe(0)
  })

  it('red: a tampered vendored wave-map source fails --check', () => {
    const dir = tempDir()
    const sources = join(dir, 'sources')
    cpSync(SOURCES, sources, { recursive: true })
    const wavePath = join(sources, 'implementation-wave-map.md')
    writeFileSync(wavePath, `${readFileSync(wavePath, 'utf8')}\n-- tampered by spec --\n`)
    const status = check(sources, REGISTRY)
    expect(status.status).not.toBe(0)
  })

  it('red: a tampered decision package source fails --check', () => {
    const dir = tempDir()
    const sources = join(dir, 'sources')
    cpSync(SOURCES, sources, { recursive: true })
    const decisionPath = join(sources, 'r0-decision-package.md')
    writeFileSync(decisionPath, `${readFileSync(decisionPath, 'utf8')}\n-- tampered by spec --\n`)
    const status = check(sources, REGISTRY)
    expect(status.status).not.toBe(0)
  })

  it('honesty: provenance does not self-report adjudication or acceptance', () => {
    const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
      provenance: { status: string; note: string }
      adjudicationPending: { status: string; count: number }
      thresholdProposals: { status: string }[]
      epics: { id: string; layerStatus: string; canonicalOwner: string }[]
    }
    expect(registry.provenance.status).toBe('CANONICAL_EXTRACTION_FROM_PINNED_SOURCES')
    expect(registry.provenance.note).toContain('PENDING_MAINTAINER_ADJUDICATION')
    expect(registry.adjudicationPending.status).toBe('PENDING_MAINTAINER')
    expect(registry.adjudicationPending.count).toBe(33)
    for (const t of registry.thresholdProposals) {
      expect(t.status).toBe('PROPOSED_PENDING_MAINTAINER')
    }
    for (const e of registry.epics) {
      // Agent A's per-layer choices are proposals until the ADR; owner assignment
      // is UNASSIGNED_UNTIL_APPROVAL for every non-spec-owner epic. DELEGATE_CONFIRMED
      // is P3-13's own resolution path (BASE-ALIGN-v2 new-gap, delegate-confirmed
      // layer at creation), distinct from the 100 canonical epics' statuses.
      expect(['AGENT_A_PROPOSED', 'PENDING_MAINTAINER_ADJUDICATION', 'DELEGATE_CONFIRMED']).toContain(e.layerStatus)
      expect(['UNASSIGNED_UNTIL_APPROVAL', e.id]).toContain(e.canonicalOwner)
    }
  })

  it('coverage: the registry pins 100 canonical epics + P3-13 (BASE-ALIGN-v2 new-gap) across waves 1..19', () => {
    const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
      groupCounts: Record<string, number>
      waveCount: number
      epics: { id: string; wave: number }[]
    }
    const ids = registry.epics.map(e => e.id)
    // These 2 literals are the ONE remaining absolute anchor for the
    // registry's epic count (delegate note, 2026-09-03): every other
    // first100 spec file's epic-count assertion was relativized to
    // `reg.epics.length` when P3-13 landed (101st epic) -- a real epic-count
    // regression a self-consistency check like that can no longer catch, if
    // the count itself silently drifted. Keep these 2 literal, not
    // `reg.epics.length` -- relativizing them too would make every
    // first100 epic-count assertion in the repo a tautology.
    expect(new Set(ids).size).toBe(101)
    expect(registry.epics).toHaveLength(101)
    expect(registry.waveCount).toBe(19)
    const waves = [...new Set(registry.epics.map(e => e.wave))].sort((a, b) => a - b)
    expect(waves[0]).toBe(1)
    expect(waves[18]).toBe(19)
    expect(Object.keys(registry.groupCounts).sort()).toEqual(
      ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
    )
  })
})
