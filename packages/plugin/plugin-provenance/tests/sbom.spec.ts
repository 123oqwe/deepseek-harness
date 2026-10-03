/**
 * P1-02 must[1] / acceptance[1] (A-573): `computeSbomDigest` orders an SBOM's
 * entries by their names' UTF-16 CODE UNITS, not by locale collation, so the
 * same locked package digests identically on every machine regardless of the
 * runtime's default locale — acceptance[1]'s "verifiable offline" has to hold
 * across machines. On the factory install/verify path the signer and the
 * verifier share this one function, so a self-consistent claim cannot reveal
 * which ordering is canonical; only an independently computed expected value
 * pins it.
 *
 * Red first for B-686 ①. §21.4: the expected digest replicates this stage's
 * SHIPPED serialization (`../src/sbom.ts`, read pre-fix) with a code-unit sort;
 * the fix diff is not read.
 */
import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { computeSbomDigest, generateSbom } from '../src/sbom.ts'
import type { DependencyKind, SbomDocument } from '../src/sbom.ts'
import type { PackageDigest } from '../src/signature.ts'

/**
 * The digest `computeSbomDigest` must produce: its own shipped serialization
 * (format, subject digest, entries), but with entries ordered by the UTF-16
 * code units of their names — the locale-independent canonical order.
 * @param sbom - the SBOM to digest.
 * @returns the expected `sha256:`-prefixed digest.
 */
function expectedCodeUnitDigest(sbom: SbomDocument): string {
  const canonicalEntries = [...sbom.entries]
    .map(entry => ({ name: entry.name, version: entry.version, kind: entry.kind, digest: entry.digest }))
    .sort((a, b) => codeUnitOrder(a.name, b.name))
  const canonical = JSON.stringify({
    format: sbom.format,
    subjectPackageDigest: sbom.subjectPackageDigest,
    entries: canonicalEntries,
  })
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

/**
 * Order two names by their UTF-16 code units, as the relational operators do.
 * @param a - the first name.
 * @param b - the second name.
 * @returns -1, 0, or 1.
 */
function codeUnitOrder(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

describe('P1-02 (A-573): computeSbomDigest orders entries by UTF-16 code unit, not locale collation', () => {
  it('digests an SBOM whose entry names sort differently by code unit than by locale identically to the code-unit order (red first for B-686)', () => {
    // 'B' (U+0042) precedes 'a' (U+0061) by code unit, but a full-ICU locale
    // collation orders 'a' before 'B'. A digest that sorted by locale would
    // move when the same locked package is verified under a different locale,
    // breaking acceptance[1]'s offline cross-machine verifiability.
    const dependencies = new Map<string, { readonly version: string; readonly kind: DependencyKind }>([
      ['B', { version: '1.0.0', kind: 'runtime' }],
      ['a', { version: '2.0.0', kind: 'runtime' }],
    ])
    const sbom = generateSbom('cyclonedx', brandString<PackageDigest>('sha256:a-573-code-unit-subject'), dependencies)

    // Today computeSbomDigest sorts by localeCompare (['a','B']); the canonical
    // code-unit order is (['B','a']), so the two digests differ and this fails.
    expect(computeSbomDigest(sbom)).toBe(expectedCodeUnitDigest(sbom))
  })
})
