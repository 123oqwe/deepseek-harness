/**
 * Shared loaders and types for the First-100 fail-closed runner/verifier
 * (R0-4). Every module resolves the repo root from `process.cwd()` because the
 * `first100:*` package scripts always run from the repository root, and reads
 * the canonical registry, the committed evidence schema, and the pinned
 * trusted identity from disk — the runner consumes committed artifacts, never
 * a separate hardcoded list.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { Adjudication, Registry } from './generate-specs.ts'

export type { Adjudication, Registry }

/** The four evidence lanes required per issue. */
export const LANES = ['contract', 'provider', 'composition', 'fault'] as const
export type Lane = (typeof LANES)[number]

/** Observation directory, gitignored; raw logs and observation JSON live here. */
export const OBSERVATIONS_DIR = '.artifacts/first100/observations'

/** A First-100 observation: exactly the 13 evidence-schema fields + signature. */
export interface Observation {
  id: string
  lane: Lane
  baselineSha: string
  command: string
  exitCode: number | null
  rawLogPath: string
  rawLogSha256: string
  testCounts: { total: number; passed: number; failed: number; skipped: number }
  worldStateBefore: string
  worldStateAfter: string
  skipReason: string
  exitSemantics: 'ACCEPTED' | 'FAIL' | 'NOT_RUN' | 'BLOCKED'
  signature: string
}

/** Verdict statuses; REJECTED covers evidence that fails verification/attestation. */
export type VerdictStatus = 'ACCEPTED' | 'FAIL' | 'NOT_RUN' | 'BLOCKED' | 'REJECTED'

/** The canonical per-epic row from the base registry. */
export type Epic = Registry['epics'][number]

/** An adjudication overlay with the fields the generator composes. */
export type Overlay = Adjudication

/**
 * Resolve the repository root. Scripts run from the root; fall back to walking
 * up from this module for robustness in tests that spawn from a subdirectory.
 */
export function resolveRepoRoot(cwd = process.cwd()): string {
  let dir = resolve(cwd)
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      readFileSync(join(dir, 'package.json'), 'utf8')
      return dir
    } catch {
      const parent = resolve(dir, '..')
      if (parent === dir) break
      dir = parent
    }
  }
  throw new Error('First-100 runner: could not locate the repository root (no package.json above the cwd)')
}

/** Load the canonical registry. */
export function loadRegistry(repoRoot = resolveRepoRoot()): Registry {
  return JSON.parse(readFileSync(join(repoRoot, 'tests/first100/registry.json'), 'utf8')) as Registry
}

/** Load the committed evidence schema (the verifier consumes it, not a hardcoded list). */
export function loadEvidenceSchema(repoRoot = resolveRepoRoot()): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, 'spec/first100-evidence.schema.json'), 'utf8')) as Record<string, unknown>
}

/** Load the adjudication overlay. */
export function loadOverlay(repoRoot = resolveRepoRoot()): Overlay {
  return JSON.parse(readFileSync(join(repoRoot, 'tests/first100/adjudication.json'), 'utf8')) as Overlay
}

/** Load the pinned trusted public identity for evidence attestation. */
export function loadPinnedIdentity(repoRoot = resolveRepoRoot()): { publicKeyPem: string; fingerprint: string } {
  const raw = JSON.parse(readFileSync(join(repoRoot, 'tests/first100/trusted-identity.json'), 'utf8')) as {
    publicKeyPem: string
    fingerprint: string
  }
  return { publicKeyPem: raw.publicKeyPem, fingerprint: raw.fingerprint }
}
