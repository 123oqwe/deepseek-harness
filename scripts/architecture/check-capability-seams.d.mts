/**
 * Declaration file for the exported functions in `check-capability-seams.mjs`,
 * consumed only by `check-capability-seams.spec.ts` (same convention as
 * `scripts/first100/generate-ledger.d.mts`). The CLI script itself stays
 * plain `.mjs` -- this does not type the whole module, only what tests import.
 */
import type {
  ArchitectureLayers,
  CapabilityFamily,
  CapabilityTestEvidence,
  ResolvedImport,
  SeamViolation,
} from './capability-seams.ts'

export function readArchitectureLayers(root: string): ArchitectureLayers

export function readWorkspacePackages(root: string): Map<string, string>

export function readAppPackages(root: string): Set<string>

export function collectImportSpecifiers(path: string, source: string): string[]

export function collectResolvedImports(root: string, packages: ReadonlyMap<string, string>): ResolvedImport[]

export function readCapabilityTestEvidence(
  root: string,
  packages: ReadonlyMap<string, string>,
  family: CapabilityFamily,
): CapabilityTestEvidence

export interface CapabilitySeamsCheckResult {
  schemaErrors: string[]
  violations: SeamViolation[]
  scanned: { packages: number; imports: number; families: number }
}

export function runCapabilitySeamsCheck(root: string): CapabilitySeamsCheckResult

export function formatViolation(violation: SeamViolation): string

export function main(): void
