/**
 * Declaration file for the exported functions in `check-layer-deps.mjs`,
 * consumed only by `check-layer-deps.spec.ts` (same convention as
 * `./check-capability-seams.d.mts`). The CLI script itself stays plain
 * `.mjs` -- this does not type the whole module, only what tests import.
 */
import type { ExemptedCycle, LayerDependencyEdge, PackageLayer } from './layer-order.ts'

/** One package's resolved layer and the rule that assigned it. */
export interface ClassifiedPackage {
  /** `composition-root` is the position outside the six-layer ranking (layering.md rule 1). */
  readonly layer: PackageLayer | 'composition-root' | 'test-support'
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
  /** The packages under `vendor/`: outside the six-layer graph and inside the cycle graph. */
  readonly vendored: Map<string, { readonly dir: string; readonly manifest: Record<string, unknown> }>
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
    | 'kernel-external-dependency'
    | 'kernel-upward-dependency'
    | 'layer-violation'
    | 'global-singleton'
    | 'stale-kernel-edge-allowlist'
    | 'expired-kernel-edge-allowlist'
    | 'composition-root-inbound-dependency'
    | 'test-support-inbound-dependency'
    | 'unexempted-cycle'
    | 'stale-exempted-cycle'
  readonly fromPackage: string
  readonly toPackage: string
  readonly detail: string
}

/** One `kernel`-layer package's edge to a vendored or external package, at binding granularity (rule 4), or an allowlisted edge to a workspace package. */
export interface KernelEdge {
  readonly fromPackage: string
  readonly toPackage: string
  /**
   * The uses of `toPackage`, sorted: an imported binding's name (a
   * `declare module` augmentation of the `Context` interface also records
   * `Context`), `*` for a reference that binds no name, `export <name>` or
   * `export *` for a re-export, `declare module <name>` for any other
   * declaration in a module augmentation, and `package.json <field>` for a
   * manifest declaration. Empty for an allowlisted edge to a workspace
   * package.
   */
  readonly bindings: string[]
  /** The repo-relative files the uses were found in, sorted. */
  readonly files: string[]
  readonly verdict: 'permitted-binding' | 'allowlisted' | 'violation'
}

/** The gate's full result for one repository or fixture root. */
export interface LayerDepsResult {
  readonly violations: LayerViolation[]
  /** Reported observations, not pass conditions: generic upward edges no registry clause requires to be zero. */
  readonly findings: LayerViolation[]
  /** Every unexempted cycle in the production package graph, each rotated to begin at its smallest package name, shortest first and then by package names. */
  readonly unexemptedCycles: readonly (readonly string[])[]
  /** The first of `unexemptedCycles`, or `undefined` when there is none. */
  readonly shortestCycle: readonly string[] | undefined
  readonly unclassified: string[]
  readonly kernelEdges: KernelEdge[]
  readonly scanned: {
    /** Classified packages. */
    readonly packages: number
    /** Packages under `vendor/`. */
    readonly vendored: number
    /** Every package `pnpm-workspace.yaml` declares: classified, vendored and unclassified. */
    readonly workspacePackages: number
    readonly edges: number
    readonly layers: number
  }
}

/** acceptance[2]: one complete run, measured from process start, finishes within this budget. */
export const TIME_BUDGET_MS: number

/**
 * Find every unexempted cycle in a production graph: through each edge no
 * record names, the shortest cycle containing it, and on the subgraph of
 * recorded edges, every simple cycle no record names. This is the search the
 * gate runs.
 * @param edges - the production graph's edges.
 * @param exemptedCycles - the validated exemption records.
 * @returns the unexempted cycles (each rotated to its smallest package, shortest first, then by package names) and the stale records.
 */
export function findUnexemptedCycles(
  edges: readonly Pick<LayerDependencyEdge, 'fromPackage' | 'toPackage'>[],
  exemptedCycles: readonly ExemptedCycle[],
): { readonly cycles: string[][]; readonly stale: ExemptedCycle[] }

/**
 * Read and validate the layer exemption store.
 * @param root - repository (or fixture) root.
 * @returns the declared exemptions and any shape errors.
 */
export function readLayerExemptions(root: string): LayerExemptions

/**
 * Assign every package `pnpm-workspace.yaml` declares a layer, except the vendored ones.
 * @param root - repository (or fixture) root.
 * @returns each package's layer, the names of any package no rule classified, and the vendored packages.
 * @throws when `pnpm-workspace.yaml` declares no package pattern, or its patterns match no package.
 */
export function classifyWorkspacePackages(root: string): ClassificationResult

/**
 * Resolve every dependency edge between workspace packages through must[2]'s
 * three detection channels.
 * @param root - repository (or fixture) root.
 * @param byPackage - the classified workspace packages.
 * @returns one resolved edge per distinct package pair.
 */
export function collectLayerEdges(root: string, byPackage: Map<string, ClassifiedPackage>): {
  readonly edges: LayerDependencyEdge[]
  /** Per-package rule-3 state facts: mutable exports, shared-global writes/reads, and imported bindings. */
  readonly facts: Map<string, unknown>
  /** `"<from> <to>"` to the mutable bindings that made the edge a global-singleton, each with the file that imports it. */
  readonly singletonBindings: Map<string, string[]>
}

/**
 * Run the full layer-dependency gate against a repository or fixture root.
 * @param root - repository (or fixture) root.
 * @returns violations, every unexempted cycle, unclassified packages, kernel edges, and scan counts.
 * @throws when `pnpm-workspace.yaml` declares no package pattern, or its patterns match no package.
 */
export function runLayerDepsCheck(root: string): LayerDepsResult
