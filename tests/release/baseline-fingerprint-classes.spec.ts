/**
 * P0-01 acceptance[1] (BLOCKED-305 condition [1]): changing any key schema,
 * the content of a bundle row, or a package manifest makes
 * `baseline-fingerprint.mjs verify` fail and name the minimal difference.
 *
 * Each case captures a committed checkout, makes one uncommitted change, and
 * verifies. The cases read `.dsh/rebase-report.json`, the machine-readable
 * drift list verify writes, not the wording of its output. "Minimal" means the
 * drift names the file that changed, only that file, and the element that
 * changed rather than the whole set it belongs to; how a drift entry names its
 * field is left to the implementation.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { git, makeFingerprintFixture, runFingerprint, write } from './fingerprint-fixture.ts'

const BUNDLE = 'packages/bundle/base/cordis.patch.yml'
const ALPHA_MANIFEST = 'packages/alpha/package.json'
const SPEC_SCHEMA = 'spec/example.schema.json'
const PROTOCOL_SCHEMA = 'packages/sdk/protocol/src/types.ts'

/** Two rows with content beyond their ids, so a change to that content has something to change. */
const ROWS = 'rows:\n  - id: row-alpha\n    name: pkg-alpha\n    config: { size: 1 }\n  - id: row-beta\n    name: pkg-beta\n'
const ALPHA = { name: '@fixture/alpha', version: '0.0.0', private: true }

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One drift entry as verify reports it. */
interface Drift {
  readonly path: string
  readonly field: string
  readonly expected?: unknown
  readonly actual?: unknown
}

/**
 * Capture a committed checkout, write one uncommitted change, and verify.
 * @param change - the new content of each changed file, by path under the checkout.
 * @returns verify's exit status and the drift it reported.
 */
function verifyAfter(change: Readonly<Record<string, string>>): { readonly status: number | null; readonly drift: readonly Drift[] } {
  const root = makeFingerprintFixture()
  roots.push(root)
  write(root, BUNDLE, ROWS)
  write(root, SPEC_SCHEMA, `${JSON.stringify({ type: 'object', properties: { kind: { type: 'string' } } }, null, 2)}\n`)
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'rows with content, and a spec schema'])
  const captured = runFingerprint('capture', root)
  if (captured.status !== 0) throw new Error(`capture failed: ${captured.stderr}`)
  for (const [path, content] of Object.entries(change)) write(root, path, content)
  const verified = runFingerprint('verify', root)
  const report = join(root, '.dsh/rebase-report.json')
  const drift = existsSync(report) ? (JSON.parse(readFileSync(report, 'utf8')) as { drift: Drift[] }).drift : []
  return { status: verified.status, drift }
}

/**
 * The alpha package's manifest with some fields changed.
 * @param fields - the fields to set.
 * @returns the change that writes it.
 */
function alphaWith(fields: Readonly<Record<string, unknown>>): Record<string, string> {
  return { [ALPHA_MANIFEST]: `${JSON.stringify({ ...ALPHA, ...fields }, null, 2)}\n` }
}

/**
 * Assert verify failed with drift only in one file, whose entries mention some texts and not others.
 * @param result - what verify reported.
 * @param path - the file that changed.
 * @param mentioned - texts the drift must contain.
 * @param absent - texts it must not.
 */
function expectMinimal(
  result: { readonly status: number | null; readonly drift: readonly Drift[] },
  path: string,
  mentioned: readonly string[],
  absent: readonly string[],
): void {
  const text = JSON.stringify(result.drift)
  expect(result.status, text).not.toBe(0)
  expect(result.drift.map(entry => entry.path), text).toContain(path)
  expect([...new Set(result.drift.map(entry => entry.path))], text).toEqual([path])
  for (const word of mentioned) expect(text.includes(word), `${word} in ${text}`).toBe(true)
  for (const word of absent) expect(text.includes(word), `${word} not in ${text}`).toBe(false)
}

describe('P0-01 acceptance[1]: a change to a bundle row, a package manifest or a key schema fails verify with its minimal difference', () => {
  it('a bundle row whose name changed', () => {
    const result = verifyAfter({ [BUNDLE]: ROWS.replace('name: pkg-alpha', 'name: pkg-renamed') })
    expectMinimal(result, BUNDLE, ['row-alpha'], ['row-beta'])
  })

  it('a bundle row whose config changed', () => {
    const result = verifyAfter({ [BUNDLE]: ROWS.replace('size: 1', 'size: 2') })
    expectMinimal(result, BUNDLE, ['row-alpha'], ['row-beta'])
  })

  it('a bundle row that became disabled', () => {
    const result = verifyAfter({ [BUNDLE]: ROWS.replace('    name: pkg-alpha\n', '    name: pkg-alpha\n    disabled: true\n') })
    expectMinimal(result, BUNDLE, ['row-alpha'], ['row-beta'])
  })

  it('bundle rows whose order changed', () => {
    const result = verifyAfter({ [BUNDLE]: 'rows:\n  - id: row-beta\n    name: pkg-beta\n  - id: row-alpha\n    name: pkg-alpha\n    config: { size: 1 }\n' })
    expect(result.status, JSON.stringify(result.drift)).not.toBe(0)
    expect(result.drift.map(entry => entry.path), JSON.stringify(result.drift)).toContain(BUNDLE)
  })

  it('a package manifest whose version changed', () => {
    expectMinimal(verifyAfter(alphaWith({ version: '0.0.1' })), ALPHA_MANIFEST, ['version'], ['packages/beta', '@fixture/beta'])
  })

  it('a package manifest whose dependencies changed', () => {
    const result = verifyAfter(alphaWith({ dependencies: { '@fixture/beta': 'workspace:^' } }))
    expectMinimal(result, ALPHA_MANIFEST, ['dependencies'], ['packages/beta'])
  })

  it('a package manifest whose scripts changed', () => {
    const result = verifyAfter(alphaWith({ scripts: { build: 'echo build' } }))
    expectMinimal(result, ALPHA_MANIFEST, ['scripts'], ['packages/beta', '@fixture/beta'])
  })

  it('the root package manifest whose scripts changed', () => {
    const root = { name: '@fixture/root', private: true, packageManager: 'pnpm@11.7.0', scripts: { check: 'echo check' } }
    const result = verifyAfter({ 'package.json': `${JSON.stringify(root, null, 2)}\n` })
    expect(result.status, JSON.stringify(result.drift)).not.toBe(0)
    expect(result.drift.map(entry => entry.path), JSON.stringify(result.drift)).toContain('package.json')
  })

  it('a spec schema that changed', () => {
    const changed = `${JSON.stringify({ type: 'object', properties: { kind: { type: 'number' } } }, null, 2)}\n`
    expectMinimal(verifyAfter({ [SPEC_SCHEMA]: changed }), SPEC_SCHEMA, [], [])
  })

  it('control: a bundle row that was added fails verify naming the bundle file', () => {
    const result = verifyAfter({ [BUNDLE]: `${ROWS}  - id: row-gamma\n` })
    expect(result.status, JSON.stringify(result.drift)).not.toBe(0)
    expect(result.drift.map(entry => entry.path), JSON.stringify(result.drift)).toContain(BUNDLE)
  })

  it('control: a package that was renamed fails verify', () => {
    const result = verifyAfter(alphaWith({ name: '@fixture/alpha-renamed' }))
    expect(result.status, JSON.stringify(result.drift)).not.toBe(0)
    expect(result.drift.length, JSON.stringify(result.drift)).toBeGreaterThan(0)
  })

  it('control: an edited protocol schema fails verify naming only that file', () => {
    const result = verifyAfter({ [PROTOCOL_SCHEMA]: 'export interface Envelope {\n  kind: number\n}\n' })
    expectMinimal(result, PROTOCOL_SCHEMA, [], [])
  })

  it('an added bundle row is reported as that row alone, not the whole set of rows', () => {
    expectMinimal(verifyAfter({ [BUNDLE]: `${ROWS}  - id: row-gamma\n` }), BUNDLE, ['row-gamma'], ['row-beta'])
  })

  it('a renamed package is reported against the manifest that changed, not the workspace manifest', () => {
    const result = verifyAfter(alphaWith({ name: '@fixture/alpha-renamed' }))
    expect(result.drift.map(entry => entry.path), JSON.stringify(result.drift)).toContain(ALPHA_MANIFEST)
  })
})
