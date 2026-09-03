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
 * @param layer - the layer to rank.
 * @returns the layer's position in {@link LAYER_ORDER}.
 */
export function layerRank(layer: PackageLayer): number {
  return LAYER_ORDER.indexOf(layer)
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
 * @param edge - the resolved edge to classify.
 * @returns the edge's verdict.
 */
export function classifyEdge(edge: LayerDependencyEdge): LayerVerdict {
  // A global-singleton bypass is forbidden regardless of layer direction
  // (must[1]) — it never reaches an 'ok' or narrow-exception verdict.
  if (edge.nature === 'global-singleton') return 'global-singleton-violation'

  // The vendored Cordis runtime sits outside the six-layer graph
  // (`toLayer` undefined). Only the kernel is constrained against it
  // (acceptance[1]); every other layer is unconstrained by this contract.
  if (edge.toLayer === undefined) {
    return edge.fromLayer === 'kernel' ? 'layer-violation' : 'ok'
  }

  const fromRank = layerRank(edge.fromLayer)
  const toRank = layerRank(edge.toLayer)
  if (toRank <= fromRank) return 'ok'

  // An upward dependency. The kernel gets no exception at all
  // (acceptance[1]: a kernel dependency on a higher layer always fails,
  // even a type-only EventMap edge). Elsewhere, the narrow event-type-only
  // exception (must[1]) is the one thing that turns an upward dependency
  // into something other than a violation.
  if (edge.fromLayer === 'kernel') return 'layer-violation'
  return edge.nature === 'event-type-only' ? 'narrow-event-type-allowed' : 'layer-violation'
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate one exempted-cycle entry's shape: a real cycle (at least two
 * distinct packages), a non-empty `reason`/`owner`, an ISO `recordedDate`,
 * and a non-empty `adrNote` path (must[3]).
 * @param entry - the exemption to check.
 * @returns violation strings, empty when well-formed.
 */
export function validateExemptedCycle(entry: ExemptedCycle): string[] {
  const violations: string[] = []
  if (entry.cycle.length < 2) violations.push('cycle must name at least two packages')
  if (entry.reason === '') violations.push('reason must not be empty')
  if (entry.owner === '') violations.push('owner must not be empty')
  if (entry.adrNote === '') violations.push('adrNote must not be empty')
  if (!ISO_DATE.test(entry.recordedDate) || Number.isNaN(Date.parse(entry.recordedDate))) {
    violations.push(`recordedDate must be an ISO calendar date (YYYY-MM-DD), got ${JSON.stringify(entry.recordedDate)}`)
  }
  return violations
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
 * The shortest cycle passing through `source`, found by BFS: nodes dequeue
 * in non-decreasing distance from `source`, so the first outgoing edge back
 * to `source` encountered while dequeuing closes the shortest possible
 * cycle through `source` — a naive DFS that stops at the first cycle it
 * structurally trips over has no such guarantee. Returns `undefined` when
 * `source` is on no cycle.
 * @param source - the package to search cycles through.
 * @param adjacency - `fromPackage` to its `toPackage` list.
 * @returns the cycle as package names in edge order, `source` first.
 */
function shortestCycleThrough(source: string, adjacency: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const predecessor = new Map<string, string | null>([[source, null]])
  const queue: string[] = [source]
  let cursor = 0
  let closingNode: string | undefined
  while (cursor < queue.length && closingNode === undefined) {
    const current = queue[cursor]
    cursor += 1
    if (current === undefined) break
    for (const next of adjacency.get(current) ?? []) {
      if (next === source) {
        closingNode = current
        break
      }
      if (!predecessor.has(next)) {
        predecessor.set(next, current)
        queue.push(next)
      }
    }
  }
  if (closingNode === undefined) return undefined

  const path: string[] = []
  let node: string | null = closingNode
  while (node !== null) {
    path.push(node)
    node = predecessor.get(node) ?? null
  }
  path.reverse()
  return path
}

/**
 * Whether `a` and `b` name the same set of packages — cycle identity for
 * exemption matching, independent of which package the search happened to
 * start from.
 */
function cyclesMatch(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every(pkg => setB.has(pkg))
}

/**
 * Find the shortest cycle in a package dependency graph, and whether it is
 * covered by a declared exemption (must[3], acceptance[0], acceptance[2]).
 * Real production-scale timing (the 10-second budget) is the caller's
 * concern once this runs against the real workspace graph; this function
 * owns only the shortest-cycle-path algorithm's correctness. Runs a BFS
 * (see {@link shortestCycleThrough}) from every package in the graph and
 * keeps the shortest result — O(packages * (packages + edges)) — rather
 * than enumerating simple cycles, whose count can grow factorially in a
 * dense graph and blow the 10-second budget (acceptance[2]).
 * @param edges - the resolved dependency edges to search.
 * @param exemptions - declared ADR-covered cycle exemptions.
 * @returns the shortest cycle found and its exemption status.
 */
export function findShortestCycle(
  edges: readonly LayerDependencyEdge[],
  exemptions: readonly ExemptedCycle[],
): CycleResult {
  const adjacency = new Map<string, string[]>()
  const nodesInOrder: string[] = []
  const seenNodes = new Set<string>()
  const addNode = (pkg: string): void => {
    if (!seenNodes.has(pkg)) {
      seenNodes.add(pkg)
      nodesInOrder.push(pkg)
    }
  }
  for (const e of edges) {
    addNode(e.fromPackage)
    addNode(e.toPackage)
    const outgoing = adjacency.get(e.fromPackage)
    if (outgoing) outgoing.push(e.toPackage)
    else adjacency.set(e.fromPackage, [e.toPackage])
  }

  let shortestCycle: string[] | undefined
  for (const source of nodesInOrder) {
    const candidate = shortestCycleThrough(source, adjacency)
    if (candidate !== undefined && (shortestCycle === undefined || candidate.length < shortestCycle.length)) {
      shortestCycle = candidate
    }
  }

  if (shortestCycle === undefined) return { shortestCycle: undefined, isExempted: false }
  const foundCycle = shortestCycle
  const isExempted = exemptions.some(exemption => cyclesMatch(foundCycle, exemption.cycle))
  return { shortestCycle: foundCycle, isExempted }
}
