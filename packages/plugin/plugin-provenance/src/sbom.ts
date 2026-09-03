/**
 * Contract-stage type surface and stub decision logic for Epic P1-02's
 * dependency-SBOM half of must[1] ("验证...依赖 SBOM" / verify the
 * dependency SBOM): generating a package's Software Bill of Materials,
 * binding it into a signed claim by digest, and checking its coverage
 * against what is actually installed. `./signature.ts`'s
 * `PackageProvenanceClaim.sbomDigest` is this module's {@link SbomDigest};
 * `./index.ts`'s `verifyPluginProvenance` combines this module's checks with
 * `./signature.ts`'s digest/source-commit/builder-identity checks into the
 * complete must[1] verification.
 *
 * **Grounding.** {@link SbomFormat} fixes the two formats validation[]
 * names verbatim ("生成 CycloneDX/SPDX SBOM" / generate a CycloneDX or SPDX
 * SBOM). `DependencyKind` has no precedent in this repo; it mirrors the
 * conventional npm dependency-field vocabulary (`dependencies`,
 * `devDependencies`, `peerDependencies`, `optionalDependencies`) this
 * module's own doc records the interpretation of.
 *
 * @module @deepseek-ai/dsh-plugin-provenance/sbom
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PackageDigest } from './signature.ts'

/** The two SBOM formats validation[] names verbatim ("生成 CycloneDX/SPDX SBOM"). */
export type SbomFormat = 'cyclonedx' | 'spdx'

/** Which npm dependency field a {@link SbomEntry} was declared under. */
export type DependencyKind = 'runtime' | 'dev' | 'peer' | 'optional'

/** One dependency entry in an {@link SbomDocument}. */
export interface SbomEntry {
  readonly name: string
  readonly version: string
  readonly kind: DependencyKind
  /** Content digest of this dependency's installed package, when known. */
  readonly digest?: PackageDigest
}

/**
 * A complete SBOM for one package (`subjectPackageDigest`). `generateSbom`
 * produces one; `verifySbomCoverage` checks one against what is actually
 * installed; `computeSbomDigest` binds one into a signed
 * `./signature.ts` `PackageProvenanceClaim`'s `sbomDigest`.
 */
export interface SbomDocument {
  readonly format: SbomFormat
  /** The {@link PackageDigest} of the package this SBOM describes. */
  readonly subjectPackageDigest: PackageDigest
  /** ISO 8601 generation timestamp. */
  readonly generatedAt: string
  readonly entries: readonly SbomEntry[]
}

/** Content digest of a serialized {@link SbomDocument}, used to bind it into a signed claim. */
export type SbomDigest = Branded<'SbomDigest'>

/**
 * must[1]'s SBOM-completeness check outcome: either every runtime
 * dependency `sbom` declares is actually installed and every installed
 * runtime dependency is declared in `sbom` (`verified: true`), or the
 * mismatch is named exactly — validation[]'s "检查所有运行依赖均被列出"
 * (check that every runtime dependency is listed) is exactly
 * `missingRuntimeDependencies` staying empty.
 */
export type SbomCoverageResult =
  | { readonly verified: true }
  | {
    readonly verified: false
    /** Runtime dependencies `sbom` declares that are not actually installed. */
    readonly missingRuntimeDependencies: readonly string[]
    /** Installed dependency names `sbom` does not declare at all. */
    readonly undeclaredDependencies: readonly string[]
  }

/**
 * Generate an {@link SbomDocument} for `subjectPackageDigest` from its
 * declared dependencies.
 * @param format - `'cyclonedx'` or `'spdx'` (validation[]).
 * @param subjectPackageDigest - the digest of the package this SBOM describes.
 * @param dependencies - every declared dependency, keyed by package name.
 * @returns a new {@link SbomDocument} with one {@link SbomEntry} per `dependencies` entry.
 */
export function generateSbom(
  format: SbomFormat,
  subjectPackageDigest: PackageDigest,
  dependencies: ReadonlyMap<string, { readonly version: string; readonly kind: DependencyKind }>,
): SbomDocument {
  throw new Error(`not implemented: generateSbom(format=${format}, subject=${String(subjectPackageDigest)}, ${String(dependencies.size)} dependencies)`)
}

/**
 * must[1]'s SBOM-coverage check: compare `sbom`'s declared runtime
 * dependencies against `installedDependencyNames`, the actual installed
 * set. Non-runtime entries (`dev`/`peer`/`optional`) are never a source of
 * `missingRuntimeDependencies` — only a declared `'runtime'` entry that is
 * absent from `installedDependencyNames` counts.
 * @param sbom - the SBOM to check.
 * @param installedDependencyNames - names of every package actually installed alongside the subject package.
 * @returns `{ verified: true }`, or `{ verified: false, missingRuntimeDependencies, undeclaredDependencies }`.
 */
export function verifySbomCoverage(
  sbom: SbomDocument,
  installedDependencyNames: ReadonlySet<string>,
): SbomCoverageResult {
  throw new Error(`not implemented: verifySbomCoverage(${String(sbom.entries.length)} entries, ${String(installedDependencyNames.size)} installed)`)
}

/**
 * Compute the content digest of `sbom`, binding it into a signed
 * `./signature.ts` `PackageProvenanceClaim.sbomDigest`. A claim's
 * `sbomDigest` differing from this computation over the actual SBOM a
 * package ships means the SBOM was swapped after signing — must[1]'s
 * "验证...依赖 SBOM" covers this integrity check as well as
 * {@link verifySbomCoverage}'s completeness check.
 * @param sbom - the SBOM document to digest.
 * @returns the {@link SbomDigest} of `sbom`'s canonical serialization.
 */
export function computeSbomDigest(sbom: SbomDocument): SbomDigest {
  throw new Error(`not implemented: computeSbomDigest(${sbom.format}, ${String(sbom.entries.length)} entries)`)
}
