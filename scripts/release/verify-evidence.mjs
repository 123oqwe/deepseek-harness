#!/usr/bin/env node
/**
 * `pnpm evidence:verify` (P0-07 P-stage implementation of the C-stage type
 * contract in `packages/assurance/evidence-format/src/types.ts` and
 * `tests/release/evidence-package.spec.ts`).
 *
 * Reads an `EvidencePackage` written by `collect-evidence.mjs` back from
 * disk and independently RECOMPUTES every digest it carries from the real,
 * current bytes of whatever it references — never re-running the gate
 * commands that produced it (acceptance[1]: fully offline verification):
 *
 *   node scripts/release/verify-evidence.mjs --evidence .dsh/evidence/evidence.json
 *
 * For every `GateEvidence` (`requiredGates` and `additionalGates` alike):
 * recomputes `recordDigest` over the record's own other fields and, for a
 * `completed` outcome, re-hashes its captured log
 * (`<sidecar>/logs/<gateId>.log`) and every listed artifact at its real
 * repo-relative path. Re-hashes `.dsh/baseline.json` against
 * `baselineFingerprint.digest`, the sidecar `gitdiff.patch` against
 * `gitDiff.digest` (and takes the working-tree patch again, `workingTreePatch`,
 * against the same digest), the sidecar `manifest.json` against
 * `sidecarManifestDigest`, and every `requiredBuildArtifacts` path. When
 * `.dsh/baseline.json` is unchanged, re-derives the fingerprint it records
 * from the checkout (`verifyBaseline`, P0-01): a new HEAD, another Node or
 * pnpm version, or a change to any file the fingerprint covers since
 * collection is a mismatch too. That re-derivation runs `git` and `pnpm` from
 * `PATH` and writes `.dsh/rebase-report.json` when it finds drift, so an
 * offline re-verification needs the collecting checkout's HEAD and toolchain.
 * Recomputes the package-level `signature` (a content-integrity digest — see
 * `collect-evidence.mjs`'s module doc for exactly what it does and does not
 * defend against) over the package's own canonical serialization. Any
 * mismatch — a referenced file's bytes changed since collection
 * (acceptance[0]'s tampering scenario), or the package JSON itself was
 * hand-edited — fails verification and names every mismatch found, not just
 * the first.
 *
 * Also re-derives must[2] against the real, loaded data rather than trusting
 * the recorded `accepted` field: when `accepted: true`, every `--required-gate`
 * id and every `--required-artifact` path declared at `collect-evidence.mjs
 * init` (`<sidecar>/manifest.json`) must genuinely be present — as a passing
 * (`exitCode === 0`) `CompletedGateEvidence` in `requiredGates` for a gate
 * id, in `requiredBuildArtifacts` for an artifact path — proving must[2]
 * holds for real collected evidence, not only for a compile-time literal.
 * The manifest sidecar is itself required to exist for this re-derivation to
 * run at all (F-stage finding: silently treating a missing manifest as
 * "nothing declared" would let a package that dropped a required gate id or
 * artifact path key entirely — as opposed to merely losing the underlying
 * file's real bytes or forging a matching outcome, both already caught
 * above — verify clean). See `verifyAcceptedInvariant`'s own doc comment for
 * how the gate-id cross-check closes the residual gap an earlier F-stage
 * pass in this epic found but could not close within its own declared
 * files.
 *
 * CLI: `node scripts/release/verify-evidence.mjs [--repo-root <path>] --evidence <path>`
 * `--repo-root` defaults to `process.cwd()`. Exits 0 with no mismatches, 1
 * otherwise, printing every mismatch found. The first output line names the
 * package's resolved path and `accepted=true` only for a package that verified
 * clean and records the boolean `true`; a package that failed says
 * `accepted=false` and names what it records in words. These are the two facts
 * a report of this gate cites (`AGENTS.md`, evidence-gate reporting). A check
 * that cannot run, for example because git or pnpm is missing, is a named
 * mismatch, so the result line is always printed.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verifyBaseline } from './baseline-fingerprint.mjs'
import { digestOfFile, digestOfValue, sidecarDir, workingTreePatch } from './collect-evidence.mjs'

function flagOne(flags, name, fallback) {
  const values = flags.get(name)
  if (values === undefined || values.length === 0) return fallback
  return values[values.length - 1]
}

/**
 * Every flag this script reads.
 *
 * Refused rather than ignored for the reason `collect-evidence` refuses one,
 * and the exposure here is wider: this parser has no boolean flags at all, so
 * EVERY token it does not recognise consumes the next argument as its value.
 * `--repo-root /tmp/x --evidence e.json` with `--repo-root` misspelt leaves
 * `--evidence` unset and the script reports a missing evidence path, which
 * reads like a caller error rather than a typo.
 */
const KNOWN_FLAGS = new Set(['--repo-root', '--evidence'])

function parseFlags(argv) {
  const flags = new Map()
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) throw new Error(`verify-evidence: unexpected argument ${JSON.stringify(token)}`)
    if (!KNOWN_FLAGS.has(token)) throw new Error(`verify-evidence: unknown flag ${JSON.stringify(token)}`)
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`verify-evidence: ${token} requires a value`)
    flags.set(token, [...(flags.get(token) ?? []), value])
    i++
  }
  return flags
}

/** Recomputes one `GateEvidence` record's own `recordDigest` and reports a mismatch. */
function verifyRecordDigest(record, label, mismatches) {
  const { recordDigest, ...rest } = record
  const recomputed = digestOfValue(rest)
  if (recomputed !== recordDigest) mismatches.push(`${label}: recordDigest mismatch (recorded ${recordDigest}, recomputed ${recomputed})`)
}

/** For a `completed` gate, re-hashes its captured log and every listed artifact from their real current bytes. */
function verifyGateFiles(record, repoRoot, dir, label, mismatches) {
  if (record.outcome !== 'completed') return
  const logPath = join(dir, 'logs', `${record.gateId}.log`)
  if (!existsSync(logPath)) {
    mismatches.push(`${label}: log file missing at ${logPath}`)
  } else {
    const recomputed = digestOfFile(logPath)
    if (recomputed !== record.logDigest) mismatches.push(`${label}: logDigest mismatch (recorded ${record.logDigest}, recomputed ${recomputed})`)
  }
  for (const artifact of record.artifacts) {
    const artifactPath = join(repoRoot, artifact.path)
    if (!existsSync(artifactPath)) {
      mismatches.push(`${label}: artifact missing at ${artifact.path}`)
      continue
    }
    const recomputed = digestOfFile(artifactPath)
    if (recomputed !== artifact.digest) mismatches.push(`${label}: artifact ${artifact.path} digest mismatch (recorded ${artifact.digest}, recomputed ${recomputed})`)
  }
}

/**
 * Re-derives must[2] against the real loaded data: an `accepted: true`
 * package must genuinely have every declared required gate id present in
 * `requiredGates` as a genuinely passing `CompletedGateEvidence`, and every
 * declared required artifact path present in `requiredBuildArtifacts`. Both
 * `requiredGateIds` and `requiredArtifactPaths` cross-reference the sidecar
 * manifest's own independently-recorded lists, never just whatever keys
 * happen to be present in `requiredGates`/`requiredBuildArtifacts` — so a
 * gate id or artifact path whose entry was deleted entirely from the
 * package (not merely left with a stale digest, or an outcome/exitCode
 * forged in place) is still caught, even against a self-consistently
 * recomputed `recordDigest`/package `signature` (no secret key is needed to
 * forge one — see `collect-evidence.mjs`'s module doc). `verify`'s caller
 * treats the manifest's own absence as a hard failure for the same reason.
 *
 * `requiredGateIds` closes a gap an earlier F-stage pass in this epic found
 * but could not close within its own declared files (only this spec and
 * this script, not `collect-evidence.mjs`): with no independently-persisted
 * list of required gate ids, a required gate's entry deleted entirely from
 * `requiredGates`, paired with a forged self-consistent signature, verified
 * clean (confirmed exploitable: two required gates both genuinely passed,
 * one entry deleted, signature recomputed to match). `collect-evidence.mjs`'s
 * `cmdInit` now persists `requiredGateIds` into the sidecar manifest,
 * parity with its pre-existing `requiredArtifactPaths` write, giving this
 * function the same independent cross-check for gate ids it already had for
 * artifact paths.
 */
function verifyAcceptedInvariant(pkg, requiredArtifactPaths, requiredGateIds, mismatches) {
  if (pkg.accepted !== true) return
  for (const gateId of requiredGateIds) {
    if (!Object.prototype.hasOwnProperty.call(pkg.requiredGates, gateId)) {
      mismatches.push(`accepted=true but required gate ${gateId} is missing from requiredGates entirely`)
    }
  }
  for (const [gateId, record] of Object.entries(pkg.requiredGates)) {
    if (record.outcome !== 'completed' || record.exitCode !== 0) {
      mismatches.push(`accepted=true but required gate ${gateId} is not a passing CompletedGateEvidence (outcome=${record.outcome}, exitCode=${record.exitCode})`)
    }
  }
  for (const path of requiredArtifactPaths) {
    if (!Object.prototype.hasOwnProperty.call(pkg.requiredBuildArtifacts, path)) {
      mismatches.push(`accepted=true but required build artifact ${path} is not recorded in requiredBuildArtifacts`)
    }
  }
}

/**
 * A thrown value's message, for a mismatch line.
 * @param {unknown} error - what was thrown.
 * @returns {string} its message.
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Verify one evidence package fully offline: recompute every digest it
 * carries from real current bytes on disk, re-derive the baseline
 * fingerprint from the checkout, and re-derive must[2] against the real
 * loaded data.
 * @param {string} repoRoot - checkout root artifact/build-artifact paths resolve against.
 * @param {string} evidencePath - path to the evidence package JSON to verify.
 * @returns {{ ok: boolean, mismatches: string[], accepted: unknown }} `accepted` is the package's recorded `accepted` field, or `null` when there is no readable package at `evidencePath`.
 */
export function verify(repoRoot, evidencePath) {
  const mismatches = []
  if (!existsSync(evidencePath)) return { ok: false, mismatches: [`no evidence package at ${evidencePath}`], accepted: null }

  let pkg
  try {
    pkg = JSON.parse(readFileSync(evidencePath, 'utf8'))
  } catch (error) {
    return { ok: false, mismatches: [`evidence package is not valid JSON: ${errorText(error)}`], accepted: null }
  }
  const dir = sidecarDir(evidencePath)

  const { signature, ...rest } = pkg
  const recomputedSignature = digestOfValue(rest)
  if (recomputedSignature !== signature) mismatches.push(`package signature mismatch (recorded ${signature}, recomputed ${recomputedSignature})`)
  if (typeof pkg.accepted !== 'boolean') mismatches.push(`accepted is ${JSON.stringify(pkg.accepted)}, not a boolean`)

  const baselinePath = join(repoRoot, '.dsh/baseline.json')
  if (!existsSync(baselinePath)) {
    mismatches.push(`no .dsh/baseline.json at ${baselinePath} to verify baselineFingerprint against`)
  } else {
    const recomputed = digestOfFile(baselinePath)
    if (recomputed !== pkg.baselineFingerprint.digest) {
      mismatches.push(`baselineFingerprint digest mismatch (recorded ${pkg.baselineFingerprint.digest}, recomputed ${recomputed})`)
    } else {
      try {
        for (const entry of verifyBaseline(repoRoot).drift) mismatches.push(`baseline drift since collection: ${entry.path} (${entry.field})`)
      } catch (error) {
        mismatches.push(`baseline re-derivation failed: ${errorText(error)}`)
      }
    }
  }

  const diffPath = join(dir, 'gitdiff.patch')
  if (!existsSync(diffPath)) {
    mismatches.push(`gitDiff sidecar missing at ${diffPath}`)
  } else {
    const recomputed = digestOfFile(diffPath)
    if (recomputed !== pkg.gitDiff.digest) mismatches.push(`gitDiff digest mismatch (recorded ${pkg.gitDiff.digest}, recomputed ${recomputed})`)
  }
  // The same working-tree patch the last collection step recorded, taken again.
  try {
    const workingTree = workingTreePatch(repoRoot, pkg.gitDiff.baseSha, evidencePath)
    if (createHash('sha256').update(workingTree).digest('hex') !== pkg.gitDiff.digest) {
      mismatches.push(`the working tree differs from the diff recorded at collection (against ${pkg.gitDiff.baseSha})`)
    }
  } catch (error) {
    mismatches.push(`working-tree diff re-derivation failed: ${errorText(error)}`)
  }

  for (const [gateId, record] of Object.entries(pkg.requiredGates)) {
    const label = `requiredGates.${gateId}`
    verifyRecordDigest(record, label, mismatches)
    verifyGateFiles(record, repoRoot, dir, label, mismatches)
  }
  for (const record of pkg.additionalGates) {
    const label = `additionalGates.${record.gateId}`
    verifyRecordDigest(record, label, mismatches)
    verifyGateFiles(record, repoRoot, dir, label, mismatches)
  }

  for (const [path, digest] of Object.entries(pkg.requiredBuildArtifacts)) {
    const artifactPath = join(repoRoot, path)
    if (!existsSync(artifactPath)) {
      mismatches.push(`required build artifact missing at ${path}`)
      continue
    }
    const recomputed = digestOfFile(artifactPath)
    if (recomputed !== digest) mismatches.push(`required build artifact ${path} digest mismatch (recorded ${digest}, recomputed ${recomputed})`)
  }

  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    mismatches.push(`manifest sidecar missing at ${manifestPath}`)
  } else {
    const recomputed = digestOfFile(manifestPath)
    if (recomputed !== pkg.sidecarManifestDigest) mismatches.push(`sidecar manifest digest mismatch (recorded ${pkg.sidecarManifestDigest}, recomputed ${recomputed})`)
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      mismatches.push(`manifest sidecar is not valid JSON: ${errorText(error)}`)
    }
    if (manifest !== undefined) verifyAcceptedInvariant(pkg, manifest.requiredArtifactPaths ?? [], manifest.requiredGateIds ?? [], mismatches)
  }

  return { ok: mismatches.length === 0, mismatches, accepted: pkg.accepted }
}

function main() {
  const flags = parseFlags(process.argv.slice(2))
  const repoRoot = flagOne(flags, '--repo-root', process.cwd())
  const evidenceArg = flagOne(flags, '--evidence')
  if (evidenceArg === undefined) throw new Error('verify-evidence: --evidence is required')
  const evidencePath = resolve(repoRoot, evidenceArg)

  const result = verify(repoRoot, evidencePath)
  if (result.ok) {
    process.stdout.write(`verify-evidence: ${evidencePath} verified offline, no mismatches, accepted=${result.accepted === true}\n`)
    process.exit(0)
  }
  process.stdout.write(`verify-evidence: ${evidencePath} FAILED verification, accepted=false (the package records ${JSON.stringify(result.accepted)}):\n${result.mismatches.map(line => `  ${line}`).join('\n')}\n`)
  process.exit(1)
}

if (import.meta.main) main()
