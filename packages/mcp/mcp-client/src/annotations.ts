/**
 * MCP `ToolAnnotations` as an INPUT to risk classification, never as a trusted
 * output (Epic P2-04 must[1], §12.61).
 *
 * **The server is not trusted, and MCP's own specification says so.** Its
 * annotations section states that clients must not make tool-use decisions
 * based on annotations received from an untrusted server. So a hint may only
 * ever RAISE the risk this harness assigns; it may never lower it. A hostile
 * server that marks a destructive tool `readOnlyHint: true` gets exactly
 * nothing for it.
 *
 * The asymmetry is deliberate and is the whole design: raising on a server's
 * say-so costs an unnecessary approval prompt, while lowering on a server's
 * say-so runs a destructive action nobody was asked about.
 *
 * Absence is not safety either. MCP's own defaults are
 * `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: true` — an
 * unannotated tool is the DANGEROUS case by the specification's own reading,
 * so it maps to no tags at all and classifies by the harness's unknown
 * default, which is the strictest policy-adjustable class.
 *
 * @module @deepseek-ai/dsh-mcp-client/annotations
 */

/**
 * The four hints MCP defines, as received.
 *
 * Every field is optional because a server may send any subset, and each is
 * `unknown` at this boundary: this is wire input, so the types the SDK
 * declares are a claim rather than a guarantee.
 */
export interface RawToolAnnotations {
  readonly readOnlyHint?: unknown
  readonly destructiveHint?: unknown
  readonly idempotentHint?: unknown
  readonly openWorldHint?: unknown
}

/** One tool's validated annotations, or why they were refused. */
export type AnnotationsVerdict =
  | { readonly ok: true; readonly annotations: ValidatedToolAnnotations }
  | { readonly ok: false; readonly reason: string }

/** The hints, once each present field has been confirmed boolean. */
export interface ValidatedToolAnnotations {
  readonly readOnlyHint?: boolean
  readonly destructiveHint?: boolean
  readonly idempotentHint?: boolean
  readonly openWorldHint?: boolean
}

/** The hint names this module reads, in the order it reports them. */
const HINT_NAMES = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const

/**
 * Validate one tool's annotations at the wire boundary (§12.61(a)).
 *
 * A malformed annotation refuses THAT TOOL and not the server: one bad entry
 * in a list of forty is a defect in one tool, and dropping the connection
 * would let a single malformed tool deny every other tool the operator
 * configured. The caller is responsible for skipping the refused tool.
 *
 * Absent annotations are valid and empty — the strictest case, not an error.
 * @param raw - the `annotations` field as the server sent it.
 * @returns the validated hints, or the refusal naming the offending field.
 */
export function validateAnnotations(raw: unknown): AnnotationsVerdict {
  if (raw === undefined || raw === null) return { ok: true, annotations: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: `annotations must be an object, received ${Array.isArray(raw) ? 'an array' : typeof raw}` }
  }
  const source = raw as Record<string, unknown>
  const annotations: Record<string, boolean> = {}
  for (const name of HINT_NAMES) {
    const value = source[name]
    if (value === undefined) continue
    if (typeof value !== 'boolean') {
      return { ok: false, reason: `annotations.${name} must be a boolean, received ${typeof value}` }
    }
    annotations[name] = value
  }
  return { ok: true, annotations }
}

/**
 * The risk domain tags one MCP tool declares, as this harness will believe
 * them (§12.61(b)).
 *
 * The operator's tags are unconditional: they come from this deployment's own
 * configuration, not from the server. The server's hints may only ADD.
 *
 * `readOnlyHint` is the one hint that would LOWER risk, so it is ignored
 * unless the operator has said this server's annotations may be believed —
 * `trustAnnotations`, a validated config field defaulting to false. Even then
 * it only contributes a `catalog-read` tag; it can never remove a tag the
 * operator declared, because the union cannot shrink.
 * @param annotations - the server's validated hints.
 * @param declared - risk domain tags the OPERATOR configured for this server.
 * @param trustAnnotations - whether this deployment believes this server's hints.
 * @returns the tags to attach, deduplicated and sorted for a stable schema.
 */
export function riskDomainTagsFor(
  annotations: ValidatedToolAnnotations,
  declared: readonly string[],
  trustAnnotations: boolean,
): readonly string[] {
  const tags = new Set(declared)
  // Upgrade-only. `destructiveHint` and `openWorldHint` raise, so they are
  // believed from any server: a hostile server can only make its own tools
  // MORE restricted by lying here, which is not an attack.
  if (annotations.destructiveHint === true) tags.add('destructive')
  if (annotations.openWorldHint === true) tags.add('external-effect')
  // The one downgrade-shaped hint, gated on the operator's trust. Without it,
  // `readOnlyHint: true` contributes nothing and the tool falls to the unknown
  // default — identical to an unannotated tool, which is the intended floor.
  if (trustAnnotations && annotations.readOnlyHint === true) tags.add('catalog-read')
  return [...tags].sort()
}
