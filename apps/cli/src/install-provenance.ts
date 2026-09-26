/**
 * Provenance on the `dsh plugin` install path (Epic P1-02's A stroke): verify
 * the claim a local tarball carries beside it, after pnpm has installed the
 * package and before any of its code runs, and produce the key-free record
 * the plugin lock keeps.
 *
 * A claim travels beside the tarball it describes, as `<tarball>.provenance.json`
 * holding `{ claim, sbom }` with an offline signature in base64: a claim
 * cannot sit inside the archive whose digest it signs. A dependency installed
 * any other way presents no claim and is recorded `unverified` (G2). Both
 * install paths are covered — a package that joins the profile's bundle
 * layers and a plain dependency a user patch loads.
 * @module @deepseek-ai/dsh/install-provenance
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readProfileManifest, resolveBundleDir, type ProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import { recordProvenanceAudit, verifyPluginProvenance } from '@deepseek-ai/dsh-plugin-provenance'
import type {
  BuilderIdentity,
  PackageDigest,
  PackageProvenanceClaim,
  ProvenanceAuditRecord,
  ProvenanceEvidence,
  PublicKeyFingerprint,
  SbomDigest,
  SbomDocument,
  SbomEntry,
  SourceCommitHash,
} from '@deepseek-ai/dsh-plugin-provenance'
import { computePackageDigest } from '@deepseek-ai/dsh-plugin-provenance/signature'
import { createTrustKernel, type TrustKernelTrustAnchor } from '@deepseek-ai/dsh-trust-kernel'
import { INSTALL_ANCHOR } from './profile-boot.ts'

const NAME = 'dsh'

/** The suffix a claim file adds to the tarball it describes. */
export const CLAIM_FILE_SUFFIX = '.provenance.json'

/** One dependency whose claim was refused, and why. */
export interface RefusedInstall {
  readonly name: string
  readonly reason: string
}

/** What verifying one install decided. */
export interface InstallProvenance {
  /** Dependencies whose claim did not verify; the install must not stand. */
  readonly refused: readonly RefusedInstall[]
  /** The record for every added or changed dependency that was not refused. */
  readonly records: ReadonlyMap<string, ProvenanceAuditRecord>
}

/**
 * Verify every dependency this install added, changed, or re-read from a
 * local tarball whose bytes no longer match the recorded digest.
 * @param before - the profile's dependencies before pnpm ran.
 * @param after - the profile's dependencies after it.
 * @param profileDir - the profile directory (spec and resolution anchor).
 * @param anchors - the profile's trust anchors.
 * @param locked - the provenance the profile's lock already records, by package name.
 * @returns the refusals, and a record for each verified or claim-less dependency that stands.
 */
export function verifyInstallProvenance(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
  profileDir: string,
  anchors: readonly TrustKernelTrustAnchor[],
  locked: ReadonlyMap<string, ProvenanceAuditRecord>,
): InstallProvenance {
  const verifiedAt = new Date().toISOString()
  const refused: RefusedInstall[] = []
  const records = new Map<string, ProvenanceAuditRecord>()
  const kernel = createTrustKernel({ trustAnchors: anchors })
  for (const [name, spec] of Object.entries(after)) {
    const unchanged = before[name] === spec
    const tarball = localTarball(spec, profileDir)
    const claimPath = tarball === undefined ? undefined : `${tarball}${CLAIM_FILE_SUFFIX}`
    if (tarball === undefined || claimPath === undefined || !existsSync(claimPath)) {
      if (!unchanged) refused.push({ name, reason: 'no-provenance-claim' })
      continue
    }
    const packageDigest = computePackageDigest(readFileSync(tarball))
    // The same spec can name new bytes: a tarball rewritten at the same path.
    if (unchanged && locked.get(name)?.packageDigest === packageDigest) continue
    const presented = readClaimFile(claimPath)
    if (typeof presented === 'string') {
      refused.push({ name, reason: `claim-unreadable: ${presented}` })
      continue
    }
    const installed = readInstalledManifest(name, profileDir)
    if (installed === undefined) {
      refused.push({ name, reason: 'installed-package-unresolvable' })
      continue
    }
    const verification = verifyPluginProvenance({
      claim: presented.claim,
      observed: {
        observedDigest: packageDigest,
        observedSourceCommit: {
          repoUrl: repositoryUrl(installed.repository),
          commitHash: brandString<SourceCommitHash>(installed.dsh?.provenance?.sourceCommit ?? installed.gitHead ?? ''),
        },
        observedBuilderIdentity: brandString<BuilderIdentity>(installed.dsh?.provenance?.builderIdentity ?? ''),
      },
      sbom: presented.sbom,
      installedDependencyNames: new Set(Object.keys(installed.dependencies ?? {})),
    }, kernel.signatureRoots)
    if (verification.trust === 'rejected') {
      refused.push({ name, reason: verification.reason })
      continue
    }
    records.set(name, recordProvenanceAudit(packageDigest, verification, verifiedAt))
  }
  return { refused, records }
}

/** The manifest fields a verification observes on an installed package. */
type InstalledManifest = ProfileManifest & {
  readonly repository?: unknown
  readonly gitHead?: string
  readonly dsh?: { readonly provenance?: { readonly sourceCommit?: string; readonly builderIdentity?: string } }
}

/**
 * Read an installed dependency's manifest.
 * @param name - the dependency's package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns the manifest, or `undefined` when the package does not resolve.
 */
function readInstalledManifest(name: string, profileDir: string): InstalledManifest | undefined {
  let dir: string
  try {
    dir = resolveBundleDir(NAME, name, INSTALL_ANCHOR, profileDir)
  } catch {
    // Unresolvable after a successful install: reported as a refusal by the caller.
    return undefined
  }
  return readProfileManifest(NAME, dir)
}

/**
 * The repository URL a manifest declares, in either npm form.
 * @param repository - the `repository` field.
 * @returns the URL, or an empty string when none is declared.
 */
function repositoryUrl(repository: unknown): string {
  if (typeof repository === 'string') return repository
  if (typeof repository === 'object' && repository !== null) {
    const url = (repository as { readonly url?: unknown }).url
    if (typeof url === 'string') return url
  }
  return ''
}

/**
 * The local tarball a dependency spec installs from.
 * @param spec - the dependency's spec in the profile's `package.json`.
 * @param profileDir - the directory a relative spec is relative to.
 * @returns the tarball's absolute path, or `undefined` for any other kind of spec.
 */
function localTarball(spec: string, profileDir: string): string | undefined {
  const path = spec.startsWith('file:') ? spec.slice('file:'.length) : undefined
  if (path === undefined || !/\.(?:tgz|tar\.gz)$/u.test(path)) return undefined
  return resolve(profileDir, path)
}

/**
 * Read and validate a claim file.
 * @param path - the claim file's path.
 * @returns the claim and the SBOM it binds, or why the file cannot be used.
 */
function readClaimFile(path: string): { readonly claim: PackageProvenanceClaim; readonly sbom: SbomDocument } | string {
  try {
    const file = record(JSON.parse(readFileSync(path, 'utf8')) as unknown, 'the file')
    return { claim: toClaim(record(file.claim, 'claim')), sbom: toSbom(record(file.sbom, 'sbom')) }
  } catch (error) {
    // Unreadable, not JSON, or not a claim: the install is refused with this message.
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * Narrow a parsed JSON value to an object.
 * @param value - the value.
 * @param where - the field path, for the error.
 * @returns the object's fields.
 * @throws when the value is not a JSON object.
 */
function record(value: unknown, where: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${where} must be an object`)
  return value as Readonly<Record<string, unknown>>
}

/**
 * Read one required string field.
 * @param fields - the object.
 * @param field - the field name.
 * @param where - the object's path, for the error.
 * @returns the string.
 * @throws when the field is not a string.
 */
function text(fields: Readonly<Record<string, unknown>>, field: string, where: string): string {
  const value = fields[field]
  if (typeof value !== 'string') throw new Error(`${where}.${field} must be a string`)
  return value
}

/**
 * Validate a claim; an offline signature arrives as base64.
 * @param fields - the parsed claim.
 * @returns the claim.
 */
function toClaim(fields: Readonly<Record<string, unknown>>): PackageProvenanceClaim {
  const sourceCommit = record(fields.sourceCommit, 'claim.sourceCommit')
  return {
    packageDigest: brandString<PackageDigest>(text(fields, 'packageDigest', 'claim')),
    sourceCommit: {
      repoUrl: text(sourceCommit, 'repoUrl', 'claim.sourceCommit'),
      commitHash: brandString<SourceCommitHash>(text(sourceCommit, 'commitHash', 'claim.sourceCommit')),
    },
    builderIdentity: brandString<BuilderIdentity>(text(fields, 'builderIdentity', 'claim')),
    sbomDigest: brandString<SbomDigest>(text(fields, 'sbomDigest', 'claim')),
    evidence: toEvidence(record(fields.evidence, 'claim.evidence')),
  }
}

/**
 * Validate the claim's evidence.
 * @param fields - the parsed evidence.
 * @returns the evidence.
 * @throws when the mode is unknown or a field is missing.
 */
function toEvidence(fields: Readonly<Record<string, unknown>>): ProvenanceEvidence {
  const where = 'claim.evidence'
  if (fields.mode === 'offline-signed') {
    return {
      mode: 'offline-signed',
      signature: new Uint8Array(Buffer.from(text(fields, 'signature', where), 'base64')),
      publicKeyFingerprint: brandString<PublicKeyFingerprint>(text(fields, 'publicKeyFingerprint', where)),
    }
  }
  if (fields.mode === 'sigstore') {
    const index = fields.transparencyLogIndex
    if (typeof index !== 'number') throw new Error(`${where}.transparencyLogIndex must be a number`)
    return {
      mode: 'sigstore',
      issuer: text(fields, 'issuer', where),
      subject: text(fields, 'subject', where),
      transparencyLogIndex: index,
      ...fields.bundle === undefined ? {} : { bundle: fields.bundle },
    }
  }
  throw new Error(`${where}.mode must be "offline-signed" or "sigstore"`)
}

/**
 * Validate the SBOM the claim binds.
 * @param fields - the parsed SBOM.
 * @returns the SBOM.
 * @throws when a field is missing or an entry is malformed.
 */
function toSbom(fields: Readonly<Record<string, unknown>>): SbomDocument {
  const format = fields.format
  if (format !== 'cyclonedx' && format !== 'spdx') throw new Error('sbom.format must be "cyclonedx" or "spdx"')
  const entries = fields.entries
  if (!Array.isArray(entries)) throw new Error('sbom.entries must be an array')
  return {
    format,
    subjectPackageDigest: brandString<PackageDigest>(text(fields, 'subjectPackageDigest', 'sbom')),
    generatedAt: text(fields, 'generatedAt', 'sbom'),
    entries: entries.map((entry: unknown, index): SbomEntry => {
      const where = `sbom.entries[${index}]`
      const entryFields = record(entry, where)
      const kind = entryFields.kind
      if (kind !== 'runtime' && kind !== 'dev' && kind !== 'peer' && kind !== 'optional') {
        throw new Error(`${where}.kind must be one of runtime, dev, peer, optional`)
      }
      return {
        name: text(entryFields, 'name', where),
        version: text(entryFields, 'version', where),
        kind,
        ...entryFields.digest === undefined ? {} : { digest: brandString<PackageDigest>(text(entryFields, 'digest', where)) },
      }
    }),
  }
}
