/**
 * Layer-dependency contract (Epic P0-04, C-stage): the canonical package
 * layer sequence (must[0]), the edge-classification rules that separate an
 * allowed narrow event-type import from a forbidden global-singleton
 * bypass (must[1]), the detected-edge shape a real scanner's three
 * detection channels populate (must[2]), and the shape of an ADR-covered
 * cycle exemption (must[3]).
 *
 * This module performs no filesystem I/O and walks no TypeScript program:
 * every function takes already-resolved edges as parameters, mirroring
 * `scripts/architecture/capability-seams.ts` (Epic P0-03). Building the
 * real package.json graph, resolving tsconfig path aliases, and finding
 * dynamic `require()`/`import()` calls across the real workspace is
 * `scripts/architecture/check-layer-deps.mjs`'s job, a later (U-stage)
 * slice — this module only owns the classification rules a scanner applies
 * to each edge it finds, and the shortest-cycle-path algorithm those
 * results feed.
 */

/** The six architectural layers this repo's packages compose from, low to high (must[0]). */
export type PackageLayer =
  | 'kernel'
  | 'protocol-types'
  | 'capability-definitions'
  | 'providers'
  | 'orchestration-runtime'
  | 'surfaces-apps'

/**
 * The canonical layer sequence, index 0 lowest (must[0]: "kernel →
 * protocol/types → capability definitions → providers →
 * orchestration/runtime → surfaces/apps"). A package may only depend on a
 * package at a strictly lower or equal rank, unless {@link classifyEdge}
 * grants a narrow exemption.
 */
export const LAYER_ORDER: readonly PackageLayer[] = [
  'kernel',
  'protocol-types',
  'capability-definitions',
  'providers',
  'orchestration-runtime',
  'surfaces-apps',
]

/**
 * The vendored Cordis runtime's package name. It sits outside the
 * six-layer workspace graph entirely — acceptance[1] names it as a
 * forbidden kernel-layer dependency target distinct from any layer, unlike
 * every other package in this repo (a `@deepseek-ai/cordis` peer
 * dependency of every harness package per root `CLAUDE.md`).
 */
export const CORDIS_PACKAGE_NAME = '@deepseek-ai/cordis'

/**
 * A curated, real subset of workspace package names to their layer,
 * transcribed from `packages/README.md`'s package-group table (must[0]).
 * This is not exhaustive over every workspace package — computing every
 * package's layer from the real workspace tree is the U-stage scanner's
 * job. Entries exist only where a `must`/`acceptance` clause needs a
 * concrete real package to test against, one representative pair per
 * layer transition this contract exercises.
 */
export const KNOWN_PACKAGE_LAYERS: Readonly<Record<string, PackageLayer>> = {
  '@deepseek-ai/dsh-trust-kernel': 'kernel',
  '@deepseek-ai/dsh-typert-protocol': 'protocol-types',
  '@deepseek-ai/dsh-sdk-protocol': 'protocol-types',
  '@deepseek-ai/dsh-llm': 'capability-definitions',
  '@deepseek-ai/dsh-shell': 'capability-definitions',
  '@deepseek-ai/dsh-llm-deepseek': 'providers',
  '@deepseek-ai/dsh-bash-local': 'providers',
  '@deepseek-ai/dsh-agent-loop': 'orchestration-runtime',
  '@deepseek-ai/dsh-agent': 'orchestration-runtime',
  '@deepseek-ai/dsh-client-web': 'surfaces-apps',
  '@deepseek-ai/dsh-host-webserver': 'surfaces-apps',
}

/**
 * `LAYER_ORDER`'s index for `layer` — a lower rank must not depend on a
 * higher rank (must[0]).
 * @param _layer - the layer to rank.
 * @returns the layer's position in {@link LAYER_ORDER}.
 */
export function layerRank(_layer: PackageLayer): number {
  throw new Error('not implemented')
}

/** The three channels a real scanner detects a dependency edge through (must[2]). */
export type DetectionMethod = 'package-graph' | 'path-alias' | 'dynamic-require'

/**
 * What a dependency edge structurally is, independent of
 * {@link DetectionMethod} (must[1]). `'value'` is an ordinary runtime
 * dependency. `'event-type-only'` is a type-only reference into a
 * documented `*EventMap` declaration-merge target — this repo's typed-event
 * convention (`packages/AGENTS.md`: "Typed events use declaration merging
 * and merge-extensible maps") — the one narrow exception must[1] allows
 * across layers. `'global-singleton'` reaches another layer's state through
 * a shared mutable global or module-level singleton instead of the
 * capability-seam `ctx`-based channel; must[1] forbids this regardless of
 * layer direction.
 */
export type EdgeNature = 'value' | 'event-type-only' | 'global-singleton'

/**
 * One directed dependency edge between two workspace packages (or the
 * vendored Cordis runtime), already resolved by a scanner.
 */
export interface LayerDependencyEdge {
  readonly fromPackage: string
  readonly fromLayer: PackageLayer
  readonly toPackage: string
  /**
   * The target's layer, or `undefined` when `toPackage` sits outside the
   * six-layer graph (the vendored Cordis runtime, see
   * {@link CORDIS_PACKAGE_NAME}).
   */
  readonly toLayer: PackageLayer | undefined
  readonly detectionMethod: DetectionMethod
  readonly nature: EdgeNature
}

/** The classification {@link classifyEdge} assigns one resolved edge (must[1], acceptance[1]). */
export type LayerVerdict = 'ok' | 'narrow-event-type-allowed' | 'global-singleton-violation' | 'layer-violation'

/**
 * Classify one already-resolved dependency edge against the layer order and
 * the narrow-event-type / global-singleton rules (must[0], must[1],
 * acceptance[1]). `detectionMethod` never changes the verdict — only an
 * edge's `nature` and its layer relationship do. A kernel-layer edge whose
 * target sits outside the six-layer graph (`toLayer` is `undefined` — the
 * vendored Cordis runtime) is always a violation (acceptance[1]); a
 * non-kernel edge to such a target is unconstrained by this contract.
 * @param _edge - the resolved edge to classify.
 * @returns the edge's verdict.
 */
export function classifyEdge(_edge: LayerDependencyEdge): LayerVerdict {
  throw new Error('not implemented')
}

/**
 * An ADR-covered exemption for one legitimate package-graph cycle
 * (must[3]). `adrNote` is a repo-relative path to the Agent Note recording
 * the decision — this repo's concrete equivalent of an ADR (root
 * `CLAUDE.md`: "Non-trivial changes MUST include an Agent Note").
 */
export interface ExemptedCycle {
  /** Package names around the cycle, in edge order; the last package depends on the first. */
  readonly cycle: readonly string[]
  readonly reason: string
  readonly owner: string
  readonly adrNote: string
  /** ISO calendar date (`YYYY-MM-DD`) the exemption was recorded. */
  readonly recordedDate: string
}

/**
 * Validate one exempted-cycle entry's shape: a real cycle (at least two
 * distinct packages), a non-empty `reason`/`owner`, an ISO `recordedDate`,
 * and a non-empty `adrNote` path (must[3]).
 * @param _entry - the exemption to check.
 * @returns violation strings, empty when well-formed.
 */
export function validateExemptedCycle(_entry: ExemptedCycle): string[] {
  throw new Error('not implemented')
}

/** One package-graph cycle search result (acceptance[0], acceptance[2]). */
export interface CycleResult {
  /**
   * The shortest cycle found, as package names in edge order with no
   * closing repeat of the first package (matching
   * {@link ExemptedCycle.cycle}'s shape), or `undefined` when the graph is
   * acyclic.
   */
  readonly shortestCycle: readonly string[] | undefined
  /** Whether `shortestCycle` matches a declared {@link ExemptedCycle} entry. `false` when `shortestCycle` is `undefined`. */
  readonly isExempted: boolean
}

/**
 * Find the shortest cycle in a package dependency graph, and whether it is
 * covered by a declared exemption (must[3], acceptance[0], acceptance[2]).
 * Real production-scale timing (the 10-second budget) is the caller's
 * concern once this runs against the real workspace graph; this function
 * owns only the shortest-cycle-path algorithm's correctness.
 * @param _edges - the resolved dependency edges to search.
 * @param _exemptions - declared ADR-covered cycle exemptions.
 * @returns the shortest cycle found and its exemption status.
 */
export function findShortestCycle(
  _edges: readonly LayerDependencyEdge[],
  _exemptions: readonly ExemptedCycle[],
): CycleResult {
  throw new Error('not implemented')
}
