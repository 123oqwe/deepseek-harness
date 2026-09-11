/**
 * The refusal that keeps a stale build from deleting corpus events.
 *
 * The case that matters is the third one: a refresh under an out-of-date
 * `lib/` must be REFUSED. Without it, the run emits the old behaviour and the
 * write-back records that as the truth, which is how `f4cb4beee8` deleted 34
 * `run/task-profile` events from `snapshots/sdk/` with nothing failing.
 */

import { mkdtemp, mkdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { assertBuiltArtifactsCurrent, stalePackages } from '../src/built-artifacts.ts'

let packagesRoot: string

/** Write a package with one source file and one built file at the given times. */
async function seedPackage(name: string, sourceMs: number, builtMs: number): Promise<void> {
  const directory = join(packagesRoot, 'group', name)
  await mkdir(join(directory, 'src'), { recursive: true })
  await mkdir(join(directory, 'lib'), { recursive: true })
  const source = join(directory, 'src', 'index.ts')
  const built = join(directory, 'lib', 'index.js')
  await writeFile(source, 'export const value = 1\n')
  await writeFile(built, 'export const value = 1\n')
  await utimes(source, sourceMs / 1_000, sourceMs / 1_000)
  await utimes(built, builtMs / 1_000, builtMs / 1_000)
}

const OLD = Date.UTC(2026, 8, 11, 3, 57)
const NEW = Date.UTC(2026, 8, 11, 15, 21)

beforeEach(async () => {
  packagesRoot = await mkdtemp(join(tmpdir(), 'dsh-built-artifacts-'))
  await mkdir(join(packagesRoot, 'group'), { recursive: true })
})

describe('stalePackages', () => {
  it('reports a package whose lib predates its src', async () => {
    await seedPackage('behind', NEW, OLD)
    const stale = stalePackages(packagesRoot)
    expect(stale).toHaveLength(1)
    expect(stale[0]?.directory).toBe('packages/group/behind')
    expect(stale[0]?.sourceMs).toBeGreaterThan(stale[0]?.builtMs ?? Infinity)
  })

  it('reports nothing when every lib is at least as new as its src', async () => {
    await seedPackage('current', OLD, NEW)
    await seedPackage('same', OLD, OLD)
    expect(stalePackages(packagesRoot)).toEqual([])
  })

  it('skips a package that publishes no lib, which cannot be stale', async () => {
    const directory = join(packagesRoot, 'group', 'source-only')
    await mkdir(join(directory, 'src'), { recursive: true })
    await writeFile(join(directory, 'src', 'index.ts'), 'export const value = 1\n')
    expect(stalePackages(packagesRoot)).toEqual([])
  })

  it('finds a stale package the caller never names, which is how the SDK corpus broke', async () => {
    // The artifact that deleted the events belonged to `packages/run/run`, a
    // package no SDK scenario mentions. A spawned profile loads the plugin
    // graph, so the check is workspace-wide rather than lane-local.
    await seedPackage('unrelated', NEW, OLD)
    await seedPackage('named-by-the-lane', OLD, NEW)
    expect(stalePackages(packagesRoot).map(entry => entry.directory)).toEqual(['packages/group/unrelated'])
  })
})

describe('assertBuiltArtifactsCurrent', () => {
  it('REFUSES a refresh under an out-of-date lib', async () => {
    await seedPackage('behind', NEW, OLD)
    expect(() => { assertBuiltArtifactsCurrent(packagesRoot, 'refresh') })
      .toThrow(/refusing to refresh the corpus[\s\S]*packages\/group\/behind/)
  })

  it('REFUSES a record under an out-of-date lib, which spends real API quota', async () => {
    await seedPackage('behind', NEW, OLD)
    expect(() => { assertBuiltArtifactsCurrent(packagesRoot, 'record') }).toThrow(/refusing to record the corpus/)
  })

  it('allows a refresh when the build is current', async () => {
    await seedPackage('current', OLD, NEW)
    expect(() => { assertBuiltArtifactsCurrent(packagesRoot, 'refresh') }).not.toThrow()
  })

  it('allows replay under a stale lib, because replay compares and never writes', async () => {
    // Deliberate: a stale build during replay produces a loud diff, which is
    // the signal that surfaced this defect in the first place. Refusing here
    // would convert a useful failure into a setup error.
    await seedPackage('behind', NEW, OLD)
    expect(() => { assertBuiltArtifactsCurrent(packagesRoot, 'replay') }).not.toThrow()
  })

  it('names every stale package, not just the first', async () => {
    await seedPackage('one', NEW, OLD)
    await seedPackage('two', NEW, OLD)
    expect(() => { assertBuiltArtifactsCurrent(packagesRoot, 'refresh') })
      .toThrow(/2 package\(s\)[\s\S]*packages\/group\/one[\s\S]*packages\/group\/two/)
  })
})
