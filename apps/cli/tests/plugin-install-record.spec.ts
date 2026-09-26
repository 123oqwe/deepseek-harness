/**
 * BLOCKED-342: the record a `dsh plugin` install keeps in its profile
 * directory from before pnpm runs until the install ends with code and data at
 * one version, which a run killed in between leaves for the next run.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearInstallRecord, installRecordPath, readInstallRecord, recordInstall } from '../src/plugin-migration.ts'

const MANIFEST = `${JSON.stringify({ name: 'profile', dependencies: { 'notes-plugin': '1.0.0' } }, undefined, 2)}\n`
const LOCK = "lockfileVersion: '9.0'\n"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/**
 * A fresh profile directory.
 * @returns its path.
 */
async function profileDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-install-record-'))
  dirs.push(dir)
  return dir
}

describe('BLOCKED-342: the install record outlives a killed run', () => {
  it('reads back the manifest and lock bytes it recorded, and the manifest parsed', async () => {
    const dir = await profileDir()
    await recordInstall(dir, MANIFEST, LOCK)

    expect(readInstallRecord(dir)).toEqual({
      manifest: MANIFEST,
      lock: LOCK,
      before: { name: 'profile', dependencies: { 'notes-plugin': '1.0.0' } },
    })
  })

  it('records a profile that had no lockfile as having none', async () => {
    const dir = await profileDir()
    await recordInstall(dir, MANIFEST, undefined)

    expect(readInstallRecord(dir)?.lock).toBeUndefined()
  })

  it('reads nothing when no install is in flight, and nothing once the record is cleared', async () => {
    const dir = await profileDir()
    expect(readInstallRecord(dir)).toBeUndefined()

    await recordInstall(dir, MANIFEST, LOCK)
    await clearInstallRecord(dir)
    expect(readInstallRecord(dir)).toBeUndefined()
  })

  it('refuses a file it did not write, naming it so an operator can restore from it', async () => {
    const dir = await profileDir()
    await writeFile(installRecordPath(dir), JSON.stringify({ manifest: 42 }), 'utf8')

    expect(() => readInstallRecord(dir)).toThrow(installRecordPath(dir))
  })
})
