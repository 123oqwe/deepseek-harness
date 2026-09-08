/**
 * MCP `ToolAnnotations` as risk INPUT, never as trusted output (Epic P2-04
 * must[1], §12.61).
 *
 * The gap these close was measured, not assumed: before this slice
 * `mcp-client/src` contained zero occurrences of `annotations` and the repo
 * contained zero occurrences of all four hint names, so every MCP tool reached
 * `gateActionRisk` with an empty tag list and classified as undeclared. That
 * is the strictest class, so the defect was not that MCP tools ran unchecked —
 * it is that a server declaring `destructiveHint` and an operator declaring
 * nothing produced the same answer, and the taxonomy carried no information.
 */
import { describe, expect, it } from 'vitest'
import { riskDomainTagsFor, validateAnnotations } from '@deepseek-ai/dsh-mcp-client/src/annotations.ts'
import { classify } from '@deepseek-ai/dsh-risk-taxonomy/classify'
import type { RiskPolicy } from '@deepseek-ai/dsh-risk-taxonomy/types'

/** Validate and map in one step, as the tool bridge does. */
function tagsFor(raw: unknown, declared: readonly string[] = [], trust = false): readonly string[] {
  const verdict = validateAnnotations(raw)
  if (!verdict.ok) throw new Error(`expected valid annotations, got: ${verdict.reason}`)
  return riskDomainTagsFor(verdict.annotations, declared, trust)
}

describe('P2-04 must[1]: a hostile server cannot lower the risk its own tools carry', () => {
  it('KEEPS the operator\'s `destructive` when the server claims the tool is read-only', () => {
    // The attack this exists for. The operator declared what the tool does;
    // the server says otherwise and gets nothing for it, because the union
    // cannot shrink and `readOnlyHint` is ignored from an untrusted server.
    expect(tagsFor({ readOnlyHint: true }, ['destructive'])).toEqual(['destructive'])
  })

  it('gives an UNANNOTATED tool no tags, so it falls to the unknown default', () => {
    // MCP's own defaults are readOnly=false / destructive=true / openWorld=true,
    // so absence is the dangerous case by the specification's own reading.
    // No tags means undeclared, which is the strictest policy-adjustable class.
    expect(tagsFor(undefined)).toEqual([])
    expect(tagsFor(null)).toEqual([])
    expect(tagsFor({})).toEqual([])
  })

  it('RAISES on destructiveHint and openWorldHint from ANY server, trusted or not', () => {
    // Believed unconditionally: a server can only make its own tools MORE
    // restricted by lying this way, which is not an attack worth defending.
    expect(tagsFor({ destructiveHint: true })).toEqual(['destructive'])
    expect(tagsFor({ openWorldHint: true })).toEqual(['external-effect'])
    expect(tagsFor({ destructiveHint: true, openWorldHint: true })).toEqual(['destructive', 'external-effect'])
  })

  it('honours readOnlyHint ONLY when the operator set trustAnnotations, and even then cannot remove a declared tag', () => {
    // The single downgrade-shaped hint, gated on the deployment vouching for
    // this server. `trustAnnotations` is a validated Config field defaulting
    // to false, not a constant.
    expect(tagsFor({ readOnlyHint: true }, [], false)).toEqual([])
    expect(tagsFor({ readOnlyHint: true }, [], true)).toEqual(['catalog-read'])
    // Trusted or not, it is a union: the operator's declaration survives.
    expect(tagsFor({ readOnlyHint: true }, ['destructive'], true)).toEqual(['catalog-read', 'destructive'])
  })
})

describe('P2-04 must[1]: a malformed annotation refuses ITS TOOL, not the server', () => {
  it('names the offending field so an operator can fix the server', () => {
    const verdict = validateAnnotations({ destructiveHint: 'yes' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toContain('annotations.destructiveHint')
    expect(verdict.ok === false && verdict.reason).toContain('boolean')
  })

  it('refuses a non-object annotations field, including an array', () => {
    // An array is an object to `typeof`, so it is rejected explicitly rather
    // than read as one with no hints — which would silently pass as empty.
    expect(validateAnnotations([]).ok).toBe(false)
    expect(validateAnnotations('read-only').ok).toBe(false)
    expect(validateAnnotations(7).ok).toBe(false)
  })

  it('ACCEPTS a partial set, because a server may send any subset of the four hints', () => {
    // The positive control: without it the refusals above would pass against a
    // validator that rejected everything, which would unregister every tool.
    const verdict = validateAnnotations({ destructiveHint: true })
    expect(verdict.ok).toBe(true)
    expect(verdict.ok && verdict.annotations).toEqual({ destructiveHint: true })
  })

  it('ignores unknown annotation fields rather than refusing, so a newer server is not unregistered', () => {
    // Forward compatibility: MCP may add hints. An unknown field is not a
    // malformed one, and refusing on it would make this client reject servers
    // that are merely newer than it.
    const verdict = validateAnnotations({ destructiveHint: true, someFutureHint: 'whatever' })
    expect(verdict.ok).toBe(true)
    expect(verdict.ok && verdict.annotations).toEqual({ destructiveHint: true })
  })
})

describe('P2-04 must[1]: the tags reach the risk gate as a CLASSIFICATION, not as decoration', () => {
  /**
   * The REAL classifier and the shipped rules, not a local re-implementation.
   *
   * A second copy of "highest matched class wins" would pass this file even if
   * `classify` disagreed with it, which is the one thing these cases exist to
   * rule out — the tag only matters because that function reads it.
   */
  const SHIPPED_POLICY: RiskPolicy = {
    rules: [
      { domainTag: 'catalog-read', riskClass: 'read' },
      { domainTag: 'destructive', riskClass: 'destructive' },
      { domainTag: 'external-effect', riskClass: 'external-communication' },
    ],
  }

  /** Classify one MCP tool exactly as the dispatch gate would. */
  function classOf(tags: readonly string[]): string {
    return classify({ actionId: 'mcp__server__tool', domainTags: tags }, SHIPPED_POLICY).riskClass
  }

  it('puts a destructiveHint tool AT OR ABOVE the workspace-write approval threshold', () => {
    // `workspace-write`'s threshold is `destructive`, so this tool is asked
    // about rather than run silently — which is the point of reading the hint.
    expect(classOf(tagsFor({ destructiveHint: true }))).toBe('destructive')
  })

  it('leaves an unannotated tool at the unknown default, which is ABOVE that threshold too', () => {
    // The floor is not lenient: an unvouched server's unannotated tool is
    // asked about as well. What the tags buy is INFORMATION — an operator
    // reading the refusal learns which of the two situations it was.
    expect(classOf(tagsFor(undefined))).toBe('security-sensitive')
  })

  it('lets a TRUSTED read-only tool classify as `read`, the only way an MCP tool gets cheaper', () => {
    // The positive control for the whole design: if nothing could ever lower,
    // `trustAnnotations` would be dead configuration.
    expect(classOf(tagsFor({ readOnlyHint: true }, [], true))).toBe('read')
    expect(classOf(tagsFor({ readOnlyHint: true }, [], false))).toBe('security-sensitive')
  })
})
