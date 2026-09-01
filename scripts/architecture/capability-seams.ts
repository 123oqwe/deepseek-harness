/**
 * Capability Seam architecture-consistency contract (Epic P0-03, C-stage):
 * the shape of `architecture.layers.json` (every capability family's Service
 * Definition, providers, consumers, and the dated/owned allowlist) and the
 * pure violation-detection functions a repo-wide scanner calls with
 * already-resolved package and import facts.
 *
 * This module performs no filesystem I/O at all — no workspace `package.json`
 * scan, no TypeScript-import walk, no `ts.Program` construction. Every
 * function here takes already-loaded data as parameters: workspace package
 * names, the parsed `architecture.layers.json` document, and
 * {@link ResolvedImport}/{@link CapabilityTestEvidence} facts. Reading
 * `architecture.layers.json`, scanning workspace `package.json` files, and
 * resolving real TypeScript imports into those facts is the scanner script's
 * job (`scripts/architecture/check-capability-seams.mjs`, a later slice);
 * this module only owns readable and stable knowledge of when a resolved
 * edge violates the seam rules must[0]/must[1]/must[2] declare.
 */

/** One capability family: a Service Definition package, its providers, and its consumers (must[0]). */
export interface CapabilityFamily {
  /** Stable identifier — the Cordis service key the definition owns (`ctx.<id>`). */
  readonly id: string
  /** npm package name of the Service Definition. */
  readonly definition: string
  /**
   * npm package names of Service Providers. A family that provides its own
   * implementation lists {@link definition} here (the documented
   * self-providing pattern, e.g. `dsh-user-approval`).
   */
  readonly providers: readonly string[]
  /** npm package names of Consumers. */
  readonly consumers: readonly string[]
}

/** Violation categories this gate detects (acceptance[2]). */
export type SeamViolationKind = 'deep-import' | 'provider-app-dependency' | 'missing-provider' | 'non-reversible-registration'

/** A pre-approved, dated, owned exception to one violation (acceptance[0], acceptance[1]). */
export interface AllowlistEntry {
  readonly kind: SeamViolationKind
  readonly from: string
  readonly to: string
  readonly reason: string
  /** Person or role accountable for eventually removing this entry. */
  readonly owner: string
  /** ISO calendar date (`YYYY-MM-DD`) after which this entry is stale. */
  readonly removalDate: string
}

/** The parsed shape of `architecture.layers.json`. */
export interface ArchitectureLayers {
  readonly $schemaVersion: 1
  readonly families: readonly CapabilityFamily[]
  readonly allowlist: readonly AllowlistEntry[]
}

/** One directed dependency relationship between two npm packages. */
export interface DependencyEdge {
  readonly from: string
  readonly to: string
}

/** One reported architecture-seam violation, carrying CI-actionable detail (acceptance[3]). */
export interface SeamViolation {
  readonly kind: SeamViolationKind
  readonly edge: DependencyEdge
  /** Repo-relative source file the violation was found in. */
  readonly sourceFile: string
  /** Human-readable fix suggestion. */
  readonly remediation: string
}

/** One resolved TypeScript import edge, already reduced from source scanning (must[1]). */
export interface ResolvedImport {
  /** npm package name of the importing file's own package. */
  readonly fromPackage: string
  /** Repo-relative path of the importing source file. */
  readonly fromFile: string
  /** npm package name the import specifier resolves to. */
  readonly toPackage: string
  /** The raw import specifier text, for diagnostics. */
  readonly toSpecifier: string
  /** Whether the specifier reaches into `toPackage`'s `src/*` rather than its published entry point. */
  readonly toIsDeepImport: boolean
}

/** Whether a newly-added replaceable capability's four must[2] artifacts exist. */
export interface CapabilityTestEvidence {
  readonly familyId: string
  readonly hasProviderFixture: boolean
  readonly hasConsumerCompositionTest: boolean
  readonly hasUnloadRollbackTest: boolean
}

/** Values that appear more than once in `values`, deduplicated and sorted. */
function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicated.add(value)
    seen.add(value)
  }
  return [...duplicated].sort()
}

/** `family.id`, or a placeholder label when it is empty (so messages stay readable). */
function familyLabel(family: CapabilityFamily): string {
  return family.id === '' ? '(missing id)' : family.id
}

/** `kind from -> to`, the stable label an allowlist entry and a matching violation share. */
function allowlistLabel(entry: Pick<AllowlistEntry, 'kind' | 'from' | 'to'>): string {
  return `${entry.kind} ${entry.from} -> ${entry.to}`
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate one capability family's internal shape: a non-empty id and no
 * repeated provider or consumer entry.
 * @param family - the family to check.
 * @returns path-qualified violation strings, empty when the family is well-formed.
 */
export function validateCapabilityFamily(family: CapabilityFamily): string[] {
  const errors: string[] = []
  if (family.id === '') errors.push('capability family id must not be empty')
  const label = familyLabel(family)
  for (const name of duplicates(family.providers)) errors.push(`${label}: providers must not repeat ${name}`)
  for (const name of duplicates(family.consumers)) errors.push(`${label}: consumers must not repeat ${name}`)
  return errors
}

/**
 * Validate one allowlist entry: a real ISO calendar `removalDate` and a
 * non-empty `owner` (acceptance[1]).
 * @param entry - the allowlist entry to check.
 * @returns violation strings, empty when the entry is well-formed.
 */
export function validateAllowlistEntry(entry: AllowlistEntry): string[] {
  const errors: string[] = []
  const label = allowlistLabel(entry)
  if (!ISO_DATE.test(entry.removalDate) || Number.isNaN(Date.parse(entry.removalDate))) {
    errors.push(`${label}: removalDate must be an ISO calendar date (YYYY-MM-DD), got ${JSON.stringify(entry.removalDate)}`)
  }
  if (entry.owner.trim() === '') errors.push(`${label}: owner must not be empty`)
  return errors
}

/**
 * Validate a complete `architecture.layers.json` document: every family
 * (id uniqueness, internal shape, and workspace-package membership for its
 * definition/providers/consumers) and every allowlist entry (shape and
 * edge uniqueness).
 * @param doc - the parsed document.
 * @param workspacePackageNames - real npm package names currently in the workspace.
 * @returns violation strings, empty when the document is fully well-formed.
 */
export function validateArchitectureLayers(
  doc: ArchitectureLayers,
  workspacePackageNames: ReadonlySet<string>,
): string[] {
  const errors: string[] = []
  const seenFamilyIds = new Set<string>()
  for (const family of doc.families) {
    errors.push(...validateCapabilityFamily(family))
    if (seenFamilyIds.has(family.id)) errors.push(`family id ${family.id} is declared more than once`)
    seenFamilyIds.add(family.id)
    const label = familyLabel(family)
    for (const name of [family.definition, ...family.providers, ...family.consumers]) {
      if (!workspacePackageNames.has(name)) errors.push(`${label}: ${name} is not a workspace package`)
    }
  }
  const seenAllowlistEdges = new Set<string>()
  for (const entry of doc.allowlist) {
    errors.push(...validateAllowlistEntry(entry))
    const label = allowlistLabel(entry)
    if (seenAllowlistEdges.has(label)) errors.push(`allowlist entry ${label} is declared more than once`)
    seenAllowlistEdges.add(label)
  }
  return errors
}

/**
 * Derive the dependency edges a capability family's declared roles permit:
 * each provider and each consumer may depend on the family's Service
 * Definition (must[0]'s "allowed dependency edges").
 * @param family - the family to derive edges for.
 * @returns the family's allowed edges, one per provider and per consumer.
 */
export function allowedDependencyEdgesFor(family: CapabilityFamily): DependencyEdge[] {
  return [...family.providers, ...family.consumers].map(from => ({ from, to: family.definition }))
}

/**
 * Detect a consumer reaching past a provider's Service Definition into the
 * provider's own `src/*` (must[1]).
 * @param edge - one resolved import.
 * @param layers - the architecture declaration the edge is checked against.
 * @returns the violation, or `null` when the edge is not a deep import into a declared provider.
 */
export function detectDeepImportViolation(edge: ResolvedImport, layers: ArchitectureLayers): SeamViolation | null {
  if (!edge.toIsDeepImport) return null
  const family = layers.families.find(candidate => candidate.providers.includes(edge.toPackage))
  if (family === undefined) return null
  return {
    kind: 'deep-import',
    edge: { from: edge.fromPackage, to: edge.toPackage },
    sourceFile: edge.fromFile,
    remediation: `import ${family.definition}'s published Service Definition instead of reaching into `
      + `${edge.toPackage}'s src/* (specifier ${edge.toSpecifier})`,
  }
}

/**
 * Detect a Service Provider depending on an app/UI package (must[1]).
 * @param edge - one resolved import.
 * @param layers - the architecture declaration the edge is checked against.
 * @param appPackages - npm package names classified as application/UI code.
 * @returns the violation, or `null` when the edge is not a provider-to-app dependency.
 */
export function detectProviderAppDependencyViolation(
  edge: ResolvedImport,
  layers: ArchitectureLayers,
  appPackages: ReadonlySet<string>,
): SeamViolation | null {
  if (!appPackages.has(edge.toPackage)) return null
  const family = layers.families.find(candidate => candidate.providers.includes(edge.fromPackage))
  if (family === undefined) return null
  return {
    kind: 'provider-app-dependency',
    edge: { from: edge.fromPackage, to: edge.toPackage },
    sourceFile: edge.fromFile,
    remediation: `${edge.fromPackage} is a Service Provider for capability family ${family.id}; `
      + `providers must not depend on app/UI package ${edge.toPackage}`,
  }
}

/**
 * Detect every capability family with zero declared providers.
 * @param layers - the architecture declaration to check.
 * @returns one violation per provider-less family.
 */
export function detectMissingProviderViolations(layers: ArchitectureLayers): SeamViolation[] {
  return layers.families
    .filter(family => family.providers.length === 0)
    .map(family => ({
      kind: 'missing-provider' as const,
      edge: { from: family.definition, to: family.definition },
      sourceFile: 'architecture.layers.json',
      remediation: `declare at least one Service Provider for capability family ${family.id} `
        + `(self-provide by listing ${family.definition} itself, or add a dedicated provider package)`,
    }))
}

/**
 * Detect a newly-added replaceable capability missing one of must[2]'s four
 * required artifacts (service definition is proven by the family's own
 * declaration; this checks the remaining three).
 * @param evidence - which of the four artifacts exist for one family.
 * @param layers - the architecture declaration `evidence.familyId` must resolve against.
 * @returns the violation, or `null` when all evidence is present.
 */
export function detectNonReversibleRegistrationViolation(
  evidence: CapabilityTestEvidence,
  layers: ArchitectureLayers,
): SeamViolation | null {
  const family = layers.families.find(candidate => candidate.id === evidence.familyId)
  if (family === undefined) throw new Error(`detectNonReversibleRegistrationViolation: unknown capability family ${evidence.familyId}`)
  const missing = [
    ...evidence.hasProviderFixture ? [] : ['a provider fixture'],
    ...evidence.hasConsumerCompositionTest ? [] : ['a consumer composition test'],
    ...evidence.hasUnloadRollbackTest ? [] : ['an unload/rollback test'],
  ]
  if (missing.length === 0) return null
  return {
    kind: 'non-reversible-registration',
    edge: { from: family.definition, to: family.definition },
    sourceFile: 'architecture.layers.json',
    remediation: `capability family ${family.id} is missing ${missing.join(', ')} required by must[2] `
      + 'before it ships as a replaceable capability',
  }
}

/**
 * Whether a detected violation is covered by a matching allowlist entry.
 * @param violation - the detected violation.
 * @param layers - the architecture declaration carrying the allowlist.
 * @returns whether an allowlist entry of the same kind and edge exists.
 */
export function isAllowlisted(violation: SeamViolation, layers: ArchitectureLayers): boolean {
  return layers.allowlist.some(entry =>
    entry.kind === violation.kind && entry.from === violation.edge.from && entry.to === violation.edge.to)
}
