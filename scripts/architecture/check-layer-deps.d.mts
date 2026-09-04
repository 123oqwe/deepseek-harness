/**
 * Declaration file for the exported functions in `check-layer-deps.mjs`,
 * consumed only by `check-layer-deps.spec.ts` (same convention as
 * `./check-capability-seams.d.mts`). The CLI script itself stays plain
 * `.mjs` -- this does not type the whole module, only what tests import.
 */
import type { ExemptedCycle, LayerDependencyEdge, PackageLayer } from './layer-order.ts'

/** One package's resolved layer and the rule that assigned it. */
export interface ClassifiedPackage {
  readonly layer: PackageLayer
  /** The rule that decided the layer: `packages/kernel`, `apps`, an `architecture.layers.json` role, or a `packages/<group>` fallback. */
  readonly source: string
  /** Repo-relative package directory. */
  readonly dir: string
  readonly manifest: Record<string, unknown>
}

/** Every workspace package's layer, plus any package no rule classified. */
export interface ClassificationResult {
  readonly byPackage: Map<string, ClassifiedPackage>
  readonly unclassified: string[]
}

/** The validated exemption store (`docs/architecture/layering.md` rules 5 and 6). */
export interface LayerExemptions {
  readonly exemptedCycles: ExemptedCycle[]
  readonly kernelEdgeAllowlist: {
    readonly fromPackage: string
    readonly toPackage: string
    readonly owner: string
    readonly reason: string
    /** ISO calendar date (`YYYY-MM-DD`) after which the entry is itself a violation. */
    readonly expires: string
  }[]
  /** Shape errors in the store; non-empty means the gate fails closed. */
  readonly errors: string[]
}

/** One rule violation the gate reports. */
export interface LayerViolation {
  readonly rule:
    | 'malformed-exemption-store'
    | 'unclassified-package'
    | 'kernel-forbidden-cordis-binding'
    | 'kernel-upward-dependency'
    | 'layer-violation'
    | 'global-singleton'
    | 'stale-kernel-edge-allowlist'
    | 'expired-kernel-edge-allowlist'
    | 'unexempted-cycle'
  readonly fromPackage: string
  readonly toPackage: string
  readonly detail: string
}

/** One `kernel`-layer package's edge to a vendored package, at binding granularity (rule 4). */
export interface KernelEdge {
  readonly fromPackage: string
  readonly toPackage: string
  /** The binding names imported from `toPackage`, sorted; empty for a package-graph-only edge. */
  readonly bindings: string[]
  /** The repo-relative source files the bindings were found in, sorted. */
  readonly files: string[]
  readonly verdict: 'permitted-binding' | 'allowlisted' | 'violation'
}

/** The gate's full result for one repository or fixture root. */
export interface LayerDepsResult {
  readonly violations: LayerViolation[]
  /** The shortest cycle in the production package graph, or `undefined` when acyclic or exempted. */
  readonly shortestCycle: readonly string[] | undefined
  readonly unclassified: string[]
  readonly kernelEdges: KernelEdge[]
  readonly scanned: { readonly packages: number; readonly edges: number; readonly layers: number }
}

/**
 * Read and validate the layer exemption store.
 * @param root - repository (or fixture) root.
 * @returns the declared exemptions and any shape errors.
 */
export function readLayerExemptions(root: string): LayerExemptions

/**
 * Assign every real workspace package a layer.
 * @param root - repository (or fixture) root.
 * @returns each package's layer, and the names of any package no rule classified.
 */
export function classifyWorkspacePackages(root: string): ClassificationResult

/**
 * Resolve every dependency edge between workspace packages through must[2]'s
 * three detection channels.
 * @param root - repository (or fixture) root.
 * @param byPackage - the classified workspace packages.
 * @returns one resolved edge per distinct package pair.
 */
export function collectLayerEdges(root: string, byPackage: Map<string, ClassifiedPackage>): LayerDependencyEdge[]

/**
 * Run the full layer-dependency gate against a repository or fixture root.
 * @param root - repository (or fixture) root.
 * @returns violations, the shortest unexempted cycle, unclassified packages, kernel edges, and scan counts.
 */
export function runLayerDepsCheck(root: string): LayerDepsResult
