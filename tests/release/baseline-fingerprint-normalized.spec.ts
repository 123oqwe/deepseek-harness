/**
 * P0-01 acceptance[0] (BLOCKED-305 condition [0], the delegate's ruling to
 * normalise): the same clean checkout gives the same fingerprint whatever
 * toolchain captures it, and nothing about the capturing machine's file
 * system enters it.
 *
 * pnpm is really swapped: a stand-in earlier on `PATH` answers `--version`
 * with another version. Node cannot be swapped on one machine, so a capture
 * made under another Node is a baseline of the same checkout whose
 * `toolchain.node` names another version, verified here.
 */

import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeFingerprintFixture, runFingerprint } from './fingerprint-fixture.ts'

/** The version the stand-in toolchain reports. */
const OTHER_VERSION = '0.0.0-a448'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A fresh committed checkout, removed after the case.
 * @returns its root.
 */
function fixture(): string {
  const root = makeFingerprintFixture()
  roots.push(root)
  return root
}

/**
 * The environment under which `pnpm --version` answers {@link OTHER_VERSION}.
 * @returns the variables to layer over this process's environment.
 */
function otherPnpm(): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'a448-pnpm-'))
  roots.push(dir)
  writeFileSync(join(dir, 'pnpm'), `#!/bin/sh\necho ${OTHER_VERSION}\n`)
  chmodSync(join(dir, 'pnpm'), 0o755)
  return { PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` }
}

/**
 * Capture a checkout and return the baseline file it wrote.
 * @param root - the checkout.
 * @param env - variables layered over this process's environment.
 * @returns the text of `.dsh/baseline.json`.
 */
function captured(root: string, env: Readonly<Record<string, string>> = {}): string {
  const result = runFingerprint('capture', root, env)
  if (result.status !== 0) throw new Error(`capture failed: ${result.stderr}`)
  return readFileSync(join(root, '.dsh/baseline.json'), 'utf8')
}

describe('P0-01 acceptance[0]: one checkout, one normalised fingerprint, whatever captures it', () => {
  it('two captures of one checkout under different pnpm versions write the same baseline', () => {
    const root = fixture()
    const first = captured(root)
    expect(captured(root, otherPnpm())).toBe(first)
  })

  it('a baseline captured under another pnpm version verifies without drift', () => {
    const root = fixture()
    captured(root, otherPnpm())
    const verified = runFingerprint('verify', root)
    expect(verified.status, verified.stdout).toBe(0)
  })

  it('a baseline captured under another Node version verifies without drift', () => {
    const root = fixture()
    const baseline = JSON.parse(captured(root)) as { toolchain: { node: string } }
    baseline.toolchain.node = OTHER_VERSION
    writeFileSync(join(root, '.dsh/baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`)
    const verified = runFingerprint('verify', root)
    expect(verified.status, verified.stdout).toBe(0)
  })

  it('control: two captures under the same toolchain write the same baseline', () => {
    const root = fixture()
    const first = captured(root)
    expect(captured(root)).toBe(first)
  })

  it('control: the path the checkout is reached by does not enter the baseline', () => {
    const root = fixture()
    const linkDir = mkdtempSync(join(tmpdir(), 'a448-link-'))
    roots.push(linkDir)
    const link = join(linkDir, 'checkout')
    symlinkSync(root, link)
    const direct = captured(root)
    expect(captured(`${root}/`)).toBe(direct)
    expect(captured(link)).toBe(direct)
    expect(direct.includes(root) || direct.includes(tmpdir()), direct).toBe(false)
  })
})
